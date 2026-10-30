#!/usr/bin/env node
// Lint the resolved compose file (all profiles) against the stack's hard rules. Reads the output of
//   COMPOSE_PROFILES=bridge,forge API_IMAGE=example.invalid/api:test docker compose -f backend/deploy/compose.yml config --format json
// on stdin and prints fixed lines only (Actions logs are public). Exit 1 on any violation.
// Rules: no host networking / pid / ipc anywhere; no privileged containers; no Docker socket or host bind
// mounts; host ports only on 127.0.0.1 and never 80/443; the forge services publish nothing, run non-root
// with a read-only root filesystem, drop all capabilities, set no-new-privileges and cpu/mem/pids limits;
// forge-cad has no network; the OpenRouter key goes to forge-worker only; the only network is ours.
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(0, 'utf8'));
const errs = [];
const S = cfg.services || {};
const FORGE = ['forge-worker', 'forge-cad'];

for (const [name, s] of Object.entries(S)) {
  if (s.network_mode === 'host' || s.pid === 'host' || s.ipc === 'host') errs.push(`${name}: host network/pid/ipc`);
  if (s.privileged) errs.push(`${name}: privileged`);
  if ((s.cap_add || []).length) errs.push(`${name}: cap_add`);
  for (const v of s.volumes || []) {
    if (v.type === 'bind' || /docker\.sock/.test(String(v.source || ''))) errs.push(`${name}: bind mount or docker socket`);
  }
  for (const p of s.ports || []) {
    const pub = Number(p.published);
    if (p.host_ip !== '127.0.0.1') errs.push(`${name}: port not bound to 127.0.0.1`);
    if (pub === 80 || pub === 443) errs.push(`${name}: host port 80/443`);
  }
  const env = s.environment || {};
  if ('OPENROUTER_API_KEY' in env && name !== 'forge-worker') errs.push(`${name}: gets the OpenRouter key`);
}
for (const name of FORGE) {
  const s = S[name];
  if (!s) { errs.push(`${name}: missing`); continue; }
  if (!(s.profiles || []).includes('forge')) errs.push(`${name}: not behind the forge profile`);
  if ((s.ports || []).length || (s.expose || []).length) errs.push(`${name}: publishes ports`);
  if (s.read_only !== true) errs.push(`${name}: root filesystem not read-only`);
  if (!(s.cap_drop || []).includes('ALL')) errs.push(`${name}: capabilities not dropped`);
  if (!(s.security_opt || []).some((o) => /^no-new-privileges(:true)?$/.test(o))) errs.push(`${name}: no-new-privileges missing`);
  if (!s.user || /^0(:|$)|^root/.test(String(s.user))) errs.push(`${name}: runs as root`);
  if (!s.mem_limit || !s.cpus || !s.pids_limit) errs.push(`${name}: cpu/mem/pids limits missing`);
  const vols = (s.volumes || []).map((v) => `${v.type}:${v.source}:${v.target}`);
  if (vols.length !== 1 || vols[0] !== 'volume:forge_jobs:/jobs') errs.push(`${name}: volumes other than forge_jobs:/jobs`);
}
if (S['forge-cad'] && S['forge-cad'].network_mode !== 'none') errs.push('forge-cad: has a network');
if (S['forge-worker'] && JSON.stringify(Object.keys(S['forge-worker'].networks || {})) !== '["web"]') errs.push('forge-worker: unexpected networks');
const nets = cfg.networks || {};
for (const [k, n] of Object.entries(nets)) {
  if (k !== 'web' || n.name !== 'printedrobotics_web' || n.external !== true) errs.push(`network ${k}: only the external printedrobotics_web is allowed`);
}

if (errs.length) {
  for (const e of errs) console.log(`::error::compose lint: ${e}`);
  process.exit(1);
}
console.log(`::notice::compose lint ok (${Object.keys(S).length} services)`);

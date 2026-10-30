#!/usr/bin/env node
// Forge eval: pick models by OUR tasks. Manual only, on the VPS (never in CI, never from the public API).
//   node backend/forge/eval/run.mjs --model anthropic/claude-opus-5.5 [--light <id>] [--tasks flashlight,cable-clip] --yes
//   node backend/forge/eval/run.mjs --local ...   # run python3 here instead of inside the forge-worker container
// By default runs `python -m eval.runner` inside the running forge-worker container (it has the key in its
// container env, the CAD socket and MuJoCo). Spend counts against FORGE_DAILY_USD. Prints the runner's fixed
// "eval: ..." lines and the JSON report; nothing else (no prompts, no key).
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
if (process.env.CI) { console.log('eval: refused (CI)'); process.exit(2); }
const local = args.includes('--local');
const rest = args.filter((a) => a !== '--local');
const ok = (v) => /^[A-Za-z0-9._:/,-]{1,120}$/.test(v) || v.startsWith('--');
if (!rest.includes('--model') || !rest.every(ok)) {
  console.log('usage: node backend/forge/eval/run.mjs --model <openrouter id> [--light <id>] [--tasks a,b] --yes [--local]');
  process.exit(2);
}
const forgeDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [cmd, argv, opts] = local
  ? ['python3', ['-m', 'eval.runner', ...rest], { cwd: forgeDir }]
  : ['docker', ['exec', '-i', '-w', '/app/backend/forge', 'printedrobotics-forge-worker-1', 'python', '-m', 'eval.runner', ...rest], {}];
const p = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] });
let buf = '';
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.startsWith('eval: ')) console.log(line);
    else if (line.startsWith('REPORT ')) console.log(JSON.stringify(JSON.parse(line.slice(7)), null, 1));
  }
});
p.on('close', (code) => process.exit(code ?? 1));

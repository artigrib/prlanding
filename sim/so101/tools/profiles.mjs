// Policy profiles of the conveyor cell (waste sorting, mission 13 input): measured in MuJoCo, in node, by the
// measuring cell src/policy/measure.js (the same code the page runs for the player's own policy).
//
//   node sim/so101/tools/profiles.mjs gen   --speed 0.02 [--n 100] [--jobs 2] [--out file]
//       Skript (beltSolve) at one belt speed: n trials per class (paper, plastic, glass, metal). Writes
//       sim/so101/profiles/skript-<cm/s>.json (or --out). --jobs splits the classes over child processes.
//   node sim/so101/tools/profiles.mjs gen   --speed 0.02 --n 100 --classes paper,glass --trials part.json
//       one part (raw trials only), for --jobs or for splitting by hand
//   node sim/so101/tools/profiles.mjs merge --speed 0.02 part1.json part2.json [--out file]
//   node sim/so101/tools/profiles.mjs check --speed 0.02 [--n 5]
//       re-measures the first n trials per class and compares them with the committed profile (measure.js
//       compareTrials: the tolerance); exit 1 if they do not agree. CI runs this per speed (tests/profiles.test.mjs).
//   node sim/so101/tools/profiles.mjs table
//       markdown summary of the committed profiles
//
// Every number in a profile comes from these trials (see measure.js for what a trial is and what is logged).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadObjectScene } from '../tests/mj-node.mjs';
import { World } from '../src/world.js';
import { ArmController } from '../src/controller.js';
import { measureCell, measureSpeed, profileFrom, validateProfile, compareTrials, CLASSES, MEASURE, OUTCOMES } from '../src/policy/measure.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = path.join(DIR, 'profiles');
export const profilePath = (policy, speed) => path.join(PROFILE_DIR, `${policy}-${Math.round(speed * 100)}.json`);

/** The measuring cell in node: the conveyor scene compiled from the repo files. */
export async function nodeCell() {
  const { mj, m, d, sizes } = await loadObjectScene('conveyor');
  const w = new World(mj, m, d); w.sizes(sizes);
  const act = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map((n) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, n));
  return measureCell({ mj, m, d, w, ctl: new ArmController(mj, m, d, act) });
}
export function readProfile(policy, speed) { return JSON.parse(fs.readFileSync(profilePath(policy, speed), 'utf8')); }
const today = () => new Date().toISOString().slice(0, 10);
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j) + '\n'); };

function profileOf(trials, speed, wall) {
  trials.sort((a, b) => a.k - b.k || CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class));
  const p = profileFrom(trials, { policy: 'skript', speed, source: 'ci', measured_at: today(), generator: 'sim/so101/tools/profiles.mjs', wall_s: wall });
  const bad = validateProfile(p);
  if (bad.length) throw new Error('profile invalid: ' + bad.join('; '));
  return p;
}

async function main(args) {
  const mode = args[0];
  const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
  const speed = +opt('speed', 0.02), n = +opt('n', mode === 'check' ? 5 : 100);
  if (mode === 'gen') {
    const jobs = +opt('jobs', 1), classes = String(opt('classes', CLASSES.join(','))).split(',');
    const t0 = Date.now();
    let trials;
    if (jobs > 1 && !opt('trials')) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
      const groups = Array.from({ length: jobs }, (_, j) => classes.filter((_, i) => i % jobs === j)).filter((g) => g.length);
      const parts = await Promise.all(groups.map((g, j) => new Promise((res, rej) => {
        const f = path.join(tmp, `part${j}.json`);
        const c = spawn(process.execPath, [fileURLToPath(import.meta.url), 'gen', '--speed', String(speed), '--n', String(n), '--classes', g.join(','), '--trials', f], { stdio: 'inherit' });
        c.on('exit', (code) => (code ? rej(new Error('job failed: ' + g)) : res(JSON.parse(fs.readFileSync(f, 'utf8')))));
      })));
      trials = parts.flatMap((p) => p.trials);
      fs.rmSync(tmp, { recursive: true, force: true });
    } else {
      const C = await nodeCell();
      trials = measureSpeed(C, { kind: 'skript' }, speed, n, { classes, onTrial: (t, i, N) => {
        if (i % 20 === 0 || i === N) console.error(`  ${speed * 100} cm/s ${classes.join('+')}: ${i}/${N} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      } });
    }
    const wall = Math.round((Date.now() - t0) / 1000);
    if (opt('trials')) { write(opt('trials'), { speed, classes, n, wall_s: wall, trials }); return; }
    const out = opt('out', profilePath('skript', speed));
    write(out, profileOf(trials, speed, wall));
    console.log(`${out}: ${trials.length} trials in ${wall} s`);
  } else if (mode === 'merge') {
    const files = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
    const parts = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const out = opt('out', profilePath('skript', speed));
    write(out, profileOf(parts.flatMap((p) => p.trials), speed, Math.max(...parts.map((p) => p.wall_s || 0))));
    console.log(out);
  } else if (mode === 'check') {
    const ref = readProfile('skript', speed), t0 = Date.now();
    const bad = validateProfile(ref);
    const C = await nodeCell();
    const trials = measureSpeed(C, { kind: 'skript' }, speed, n);
    const r = compareTrials(ref, trials);
    console.log(`${speed * 100} cm/s: ${r.matched}/${r.n} trials repeat, success per attempt ${r.rate == null ? '–' : r.rate.toFixed(3)} (profile ${r.rateRef}), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    for (const p of [...bad, ...r.problems]) console.log('  ' + p);
    if (bad.length || !r.ok) process.exitCode = 1;
  } else if (mode === 'table') {
    console.log(table(MEASURE.speeds.map((s) => fs.existsSync(profilePath('skript', s)) ? readProfile('skript', s) : null).filter(Boolean)));
  } else {
    console.error('usage: profiles.mjs gen|merge|check|table --speed 0.02 [--n N]');
    process.exitCode = 2;
  }
}

const pc = (v) => (v == null ? '–' : (100 * v).toFixed(1) + ' %');
/** Markdown table of profiles: per speed and class. */
export function table(list) {
  const rows = ['| speed | class | items | attempts | sorted / item | success / attempt | t_grasp p50 (p10–p90) s | t_return p50 (p10–p90) s | window (m) | failures |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const p of list) for (const [c, s] of Object.entries(p.classes)) {
    const q = (k) => `${s.quantiles[k].p50} (${s.quantiles[k].p10}–${s.quantiles[k].p90})`;
    const f = OUTCOMES.slice(1).filter((k) => s.outcomes[k]).map((k) => `${k} ${s.outcomes[k]}`).concat(Object.entries(s.passes).map(([k, v]) => `pass:${k} ${v}`)).join(', ');
    rows.push(`| ${p.speed * 100} cm/s | ${c} | ${s.trials} | ${s.attempts} | ${pc(s.sorted_per_item)} | ${pc(s.success_per_attempt)} | ${q('t_grasp')} | ${q('t_return')} | ${s.window_m ? s.window_m.join(' … ') : '–'} | ${f || '–'} |`);
  }
  return rows.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));

// Assembly-step illustrations for the SO-101 guide (navody/so101-sestaveni, en/guides/so101-assembly).
// Rendered from the CAD model the site already ships (sim/so101/model: MuJoCo Menagerie robotstudio_so101,
// from The Robot Studio SO-ARM100, Apache-2.0, see sim/so101/NOTICE.txt). No frames from third-party videos.
//
// Usage (repo root served on BASE; headless SwiftShader is fine, ≈ 5 s per step on 2 cores):
//   python3 -m http.server 8123 &
//   node tools/render-kit/so101-steps.mjs [only=03-j1-servo,…] [contact=/path/contact.png]
// Writes img/assembly/so101/<id>-1200.{webp,jpg} and <id>-600.{webp,jpg} (each must stay < 120 KB).
// Needs Playwright (require('playwright') / NODE_PATH).
//
// Conventions: already assembled parts neutral grey (servos darker grey), the part(s) added in the step in the
// accent orange, a faint orange ghost at the exploded position with a dashed arrow to the final position.
// Screws are not in the model: numbered dots + a legend with flat screw glyphs, sizes only from the guide
// (M2×6, M3×6). Dot positions are schematic (which side / which servo), not exact hole positions.
// All overlay text is language-neutral (numbers, "ID n", "4× M2×6"), so one image set serves CZ and EN.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'img/assembly/so101');
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const only = arg('only', '').split(',').filter(Boolean);
const contact = arg('contact', '');
const LIMIT = 120 * 1024;

// part keys: <MuJoCo body>:<mesh>
const P = {
  base: 'base:base_so101_v2', baseHolder: 'base:base_motor_holder_so101_v1', plate: 'base:waveshare_mounting_plate_so101_v2',
  s1: 'base:sts3215_03a_v1', s2: 'shoulder:sts3215_03a_v1', shHolder: 'shoulder:motor_holder_so101_base_v1', shoulder: 'shoulder:rotation_pitch_so101_v1',
  s3: 'upper_arm:sts3215_03a_v1', upper: 'upper_arm:upper_arm_so101_v1',
  fore: 'lower_arm:under_arm_so101_v1', wrHolder: 'lower_arm:motor_holder_so101_wrist_v1', s4: 'lower_arm:sts3215_03a_v1',
  s5: 'wrist:sts3215_03a_no_horn_v1', wrist: 'wrist:wrist_roll_pitch_so101_v2',
  s6: 'gripper:sts3215_03a_v1', jaw: 'gripper:wrist_roll_follower_so101_v1', mjaw: 'moving_jaw_so101_v1:moving_jaw_so101_v1'
};
// assembly order (follows the guide, stage 3); the plate comes with the electronics (stage 4)
const ORDER = ['base', 's1', 'baseHolder', 'shoulder', 'shHolder', 's2', 'upper', 's3', 'fore', 'wrHolder', 's4', 's5', 'wrist', 'jaw', 's6', 'mjaw', 'plate'].map((k) => P[k]);
const before = (k) => ORDER.slice(0, ORDER.indexOf(P[k]));
const ALL = ORDER;
// servo centres and horn centres at the assembly pose (all joints 0), MuJoCo world frame, mm
const SC = { 1: [27, 0, 44], 2: [70, 0, 104], 3: [85, 0, 230], 4: [220, 0, 235], 5: [275, 12, 235], 6: [316, 0, 242] };
const M2 = (n) => `${n}× M2×6`, M3 = (n) => `${n}× M3×6`;

// camera families: one framing per joint group, the same azimuth / elevation everywhere
const CAM = {
  j1: { frame: [P.base, P.s1, P.baseHolder, P.shoulder, P.shHolder], zoom: 1.0 },
  j2: { frame: [P.shoulder, P.shHolder, P.s2, P.upper], zoom: 1.0 },
  j3: { frame: [P.upper, P.s3, P.fore], zoom: 1.0 },
  j45: { frame: [P.fore, P.wrHolder, P.s4, P.s5, P.wrist], zoom: 0.95 },
  grip: { frame: [P.wrist, P.s5, P.jaw, P.s6, P.mjaw], zoom: 0.95 },
  arm: { frame: ALL, zoom: 0.66 }
};

export const STEPS = [
  // ---- stage 2: IDs ----
  { id: '01-ids', stage: 'e2', ...CAM.arm, done: ALL, hot: [P.s1, P.s2, P.s3, P.s4, P.s5, P.s6],
    tags: [[1, [-70, 30]], [2, [-80, -10]], [3, [-60, -60]], [4, [10, -80]], [5, [40, -90]], [6, [70, -50]]].map(([id, off]) => ({ id, at: { mm: SC[id] }, off })) },
  { id: '02-one-servo', stage: 'e2', solo: [P.s6], frame: [P.s6], zoom: 1.7, pan: [0.55, 0.05], ground: false,
    tags: [{ id: 6, at: { mm: [316, 0, 250] }, off: [80, -70] }],
    board: { at: { mm: [316, 0, 242] }, off: [-330, 120] }, cableBoard: { mm: [322, 0, 220] } },
  // ---- stage 3: horns (general rule) ----
  { id: '03-horns', stage: 'e3', solo: [P.s1], frame: [P.s1], hornHot: true, zoom: 1.35, el: 30, ground: false,
    marks: [{ at: { mm: [39, 0, 65] }, dir: [1, 0, 0], len: 0.009 }],
    screws: [{ label: M3(1), at: { mm: [39, 0, 65] } }] },
  // ---- joint 1 ----
  { id: '04-j1-servo', stage: 'e3', ...CAM.j1, done: [P.base], add: [{ part: P.s1, dir: [0, 0, 1], dist: 0.075 }],
    tags: [{ id: 1, at: { mm: [20, -12, 40] }, off: [-120, 40] }],
    screws: [{ label: M2(4), at: [{ mm: [6, -12, 62] }, { mm: [47, -12, 62] }] }] },
  { id: '05-j1-holder', stage: 'e3', ...CAM.j1, done: before('baseHolder'), add: [{ part: P.baseHolder, dir: [0, 0, 1], dist: 0.07 }],
    screws: [{ label: M2(2), at: [{ mm: [20, -24, 52] }] }] },
  { id: '06-j1-shoulder', stage: 'e3', ...CAM.j1, done: before('shoulder'), add: [{ part: P.shoulder, dir: [0, 0, 1], dist: 0.07 }, { part: P.shHolder, dir: [0, 0, 1], dist: 0.11 }],
    screws: [{ label: M3(4), at: [{ mm: [39, 0, 66] }] }, { label: M3(4), at: [{ mm: [39, -14, 20] }] }] },
  // ---- joint 2 ----
  { id: '07-j2-servo', stage: 'e3', ...CAM.j2, done: before('s2'), add: [{ part: P.s2, dir: [0, 0, 1], dist: 0.07 }],
    tags: [{ id: 2, at: { mm: [76, -10, 110] }, off: [90, -30] }],
    screws: [{ label: M2(4), at: [{ mm: [58, -20, 98] }, { mm: [82, -20, 98] }] }] },
  { id: '08-j2-upper-arm', stage: 'e3', ...CAM.j2, done: before('upper'), add: [{ part: P.upper, dir: [0, 0, 1], dist: 0.07 }],
    screws: [{ label: M3(4), at: [{ mm: [69, -24, 117] }] }] },
  // ---- joint 3 ----
  { id: '09-j3-servo', stage: 'e3', ...CAM.j3, done: before('s3'), add: [{ part: P.s3, dir: [0, 0, 1], dist: 0.06 }],
    tags: [{ id: 3, at: { mm: [85, -10, 236] }, off: [-90, -40] }],
    screws: [{ label: M2(4), at: [{ mm: [62, -20, 236] }, { mm: [106, -20, 236] }] }] },
  { id: '10-j3-forearm', stage: 'e3', ...CAM.j3, done: before('fore'), add: [{ part: P.fore, dir: [1, 0, 0], dist: 0.11 }],
    screws: [{ label: M3(4), at: [{ mm: [97, -24, 229] }] }] },
  // ---- joint 4 ----
  { id: '11-j4-holder-servo', stage: 'e3', ...CAM.j45, done: before('wrHolder'), add: [{ part: P.wrHolder, dir: [0, 0, 1], dist: 0.05 }, { part: P.s4, dir: [1, 0, 0], dist: 0.06 }],
    tags: [{ id: 4, at: { mm: [228, -10, 240] }, off: [40, -80] }],
    screws: [{ label: M2(4), at: [{ mm: [200, -21, 240] }, { mm: [238, -21, 240] }] }] },
  // ---- joint 5 ----
  { id: '12-j5-wrist', stage: 'e3', ...CAM.j45, done: before('s5'), add: [{ part: P.s5, dir: [1, 0, 0], dist: 0.06 }, { part: P.wrist, dir: [1, 0, 0], dist: 0.06 }],
    tags: [{ id: 5, at: { mm: [280, 0, 245] }, off: [60, -70] }],
    screws: [{ label: M2(2), at: [{ mm: [296, 10, 228] }] }, { label: M3(4), at: [{ mm: [232, -26, 234] }] }] },
  // ---- gripper ----
  { id: '13-gripper', stage: 'e3', ...CAM.grip, frame: before('mjaw'), zoom: 0.62, done: before('jaw'), add: [{ part: P.jaw, dir: [1, 0, 0], dist: 0.05 }, { part: P.s6, dir: [0, 0, 1], dist: 0.06 }],
    tags: [{ id: 6, at: { mm: [316, -10, 250] }, off: [60, -70] }],
    screws: [{ label: M3(4), at: [{ mm: [297, 0, 234] }] }, { label: M2(4), at: [{ mm: [316, -22, 230] }] }] },
  { id: '14-moving-jaw', stage: 'e3', ...CAM.grip, done: before('mjaw'), add: [{ part: P.mjaw, dir: [0, 0, 1], dist: 0.05 }],
    screws: [{ label: M3(4), at: [{ mm: [317, -22, 255] }] }] },
  // ---- stage 4: electronics ----
  { id: '15-plate', stage: 'e4', ...CAM.j1, frame: ALL, zoom: 0.62, done: before('plate'), add: [{ part: P.plate, dir: [-1, 0, 0], dist: 0.06 }] },
  { id: '16-daisy-chain', stage: 'e4', ...CAM.arm, done: ALL,
    board: { at: { mm: [-27, 0, 47] }, off: [-40, 0] },
    cable: ['board', ...[1, 2, 3, 4, 5, 6].map((n) => ({ mm: SC[n] }))],
    dots: [1, 2, 3, 4, 5, 6].map((n) => ({ n: String(n), at: { mm: SC[n] }, acc: true, r: 17 })) }
];

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => { console.error(e); process.exitCode = 1; });
  await page.goto(`${BASE}/tools/render-kit/so101-steps.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.setup());
  let total = 0;
  for (const s of STEPS) {
    if (only.length && !only.includes(s.id)) continue;
    let q = { qWebp: 0.82, qJpg: 0.84 }, out;
    // lower the quality until every file is under the limit
    for (;;) {
      out = await page.evaluate((o) => window.renderStep(o), { ...s, ...q });
      const big = Object.values(out).some((u) => (u.length - u.indexOf(',') - 1) * 0.75 > LIMIT);
      if (!big || q.qJpg < 0.5) break;
      q = { qWebp: q.qWebp - 0.06, qJpg: q.qJpg - 0.06 };
    }
    const sizes = [];
    for (const [k, url] of Object.entries(out)) {
      const f = path.join(OUT, `${s.id}-${k}`), b = Buffer.from(url.split(',')[1], 'base64');
      fs.writeFileSync(f, b); total += b.length; sizes.push(`${k} ${(b.length / 1024).toFixed(1)} KB`);
      if (b.length > LIMIT) { console.error(`${f} is over 120 KB`); process.exitCode = 1; }
    }
    console.log(s.id.padEnd(20), sizes.join('  '));
  }
  console.log(`total ${(total / 1024).toFixed(1)} KB`);
  if (contact) {
    // contact sheet of the 600 px JPEGs, 4 per row, with the step id under each
    const files = STEPS.map((s) => s.id);
    const png = await page.evaluate(async (ids) => {
      const cols = 4, w = 600, h = 450, lab = 34, rows = Math.ceil(ids.length / cols);
      const c = document.createElement('canvas'); c.width = cols * w; c.height = rows * (h + lab);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      for (const [i, id] of ids.entries()) {
        const im = new Image(); im.src = `../../img/assembly/so101/${id}-600.jpg?${Date.now()}`; await im.decode();
        const x = (i % cols) * w, y = Math.floor(i / cols) * (h + lab);
        g.drawImage(im, x, y, w, h); g.fillStyle = '#0E0E0E'; g.font = '600 20px Inter, Arial, sans-serif'; g.fillText(id, x + 12, y + h + 24);
      }
      return c.toDataURL('image/png');
    }, files);
    fs.mkdirSync(path.dirname(contact), { recursive: true });
    fs.writeFileSync(contact, Buffer.from(png.split(',')[1], 'base64'));
    console.log('contact sheet', contact);
  }
  await browser.close();
}

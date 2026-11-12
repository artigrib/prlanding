// Conveyor overlays of mission 11 (three.js, MuJoCo frame under app.world):
//   * a name plate over every bin (PAPÍR, PLAST, SKLO, KOV) in the bin's colour, so a bin is known by colour and name;
//   * hint rung 2 (and up, until the mission changes): the bin of the item in the jaws (or the belt item nearest the gripper) gets an outline, and a thin
//     line on the belt runs from that item to where it will be in 3 s (belt speed × 3 s: a true prediction while the
//     belt keeps its speed; nothing is drawn while it stands);
//   * failure feedback: the bin that got a wrong item is outlined amber for 3 s (no red flash).

import { FRACTION_BIN, FIXTURES, BELT } from '../objects/scene.js';
import { FRACTION_CS } from '../missions.js';
import { t as tr } from '../i18n/index.js';

const BIN_RGB = { bin_paper: '#1F3BFF', bin_plastic: '#F5C219', bin_glass: '#1F8C4D', bin_metal: '#2B2B2B' };
const TEXT_RGB = { bin_plastic: '#141414' };
const ACCENT = 0xe8461e, AMBER = 0xf5a623, AHEAD = 3;   // s of the belt prediction

export class BeltView {
  constructor(ux) {
    const T = this.T = ux.T;
    this.ux = ux; this.w = ux.world;
    this.root = new T.Group(); this.root.renderOrder = 6;
    ux.app.world.add(this.root);
    this.bins = {};
    for (const [frac, fx] of Object.entries(FRACTION_BIN)) {
      const z = FIXTURES[fx].zone, g = new T.Group();
      // outline: four flat bars just outside the walls, at the rim
      const mat = new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthTest: false });
      const t = 0.008, hx = z.hx + 0.014, hy = z.hy + 0.014;
      for (const [sx, sy, px, py] of [[2 * hx + t, t, 0, hy], [2 * hx + t, t, 0, -hy], [t, 2 * hy + t, hx, 0], [t, 2 * hy + t, -hx, 0]]) {
        const m = new T.Mesh(new T.BoxGeometry(sx, sy, 0.002), mat); m.position.set(px, py, z.top + 0.004); m.renderOrder = 6; g.add(m);
      }
      g.visible = false; g.userData.mat = mat;
      this.root.add(g);
      const plate = this.plate(tr(FRACTION_CS[frac]).toLocaleUpperCase(), BIN_RGB[fx], TEXT_RGB[fx] || '#FFFFFF');
      this.root.add(plate);
      this.bins[fx] = { outline: g, plate, zone: z };
    }
    const lm = new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthTest: false });
    this.line = new T.Mesh(new T.BoxGeometry(0.005, 1, 0.001), lm); this.line.visible = false; this.line.renderOrder = 6;
    this.dot = new T.Mesh(new T.CylinderGeometry(0.009, 0.009, 0.001, 24), lm); this.dot.rotation.x = Math.PI / 2; this.dot.visible = false; this.dot.renderOrder = 6;
    this.root.add(this.line, this.dot);
    this.p = new Float64Array(3);
    this.reset();
  }

  plate(text, bg, fg) {
    const T = this.T, c = document.createElement('canvas'); c.width = 256; c.height = 72;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 72);
    g.fillStyle = fg; g.font = '600 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 38);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false }));
    s.scale.set(0.075, 0.021, 1);
    return s;
  }

  /** After a mission layout: plates over the bins (shown only in conveyor missions), overlays off. */
  reset() {
    const on = !!this.ux.runner.m.belt;
    for (const [fx, b] of Object.entries(this.bins)) {
      const e = this.w.o[fx], p = this.w.pos(fx, [0, 0, 0]);
      b.outline.position.set(p[0], p[1], p[2]);
      // the plate floats just past the bin's outer end (away from the belt's middle), clear of what stands in it
      b.plate.position.set(p[0], p[1] + Math.sign(p[1]) * (b.zone.hy + 0.03), 0.035);
      b.plate.visible = on && !!e.active;
      b.outline.visible = false;
    }
    this.line.visible = this.dot.visible = false;
  }

  tick() {
    const ux = this.ux, run = ux.wasteRun();
    for (const b of Object.values(this.bins)) b.outline.visible = false;
    this.line.visible = this.dot.visible = false;
    if (!run || ux.app.won) return;
    // a wrong drop: that bin amber for 3 s
    const ev = run.last;
    if (ev && ev.ev === 'bin' && !ev.ok && run.t - ev.t < 3) this.show(ev.bin, AMBER);
    if (ux.panel.hintLevel < 2) return;   // hint rung 2 and up
    const tip = ux.runner.ctx.tip;
    let it = run.items.find((x) => x.state === 'held'), bd = 0.12;
    if (!it) for (const x of run.items) {
      if (x.state !== 'belt') continue;
      const p = this.w.com(x.name, this.p), d = Math.hypot(p[0] - tip[0], p[1] - tip[1]);
      if (d < bd) { bd = d; it = x; }
    }
    if (!it) return;
    this.show(FRACTION_BIN[it.fraction], ACCENT);
    const v = this.w.belt.v;
    if (it.state !== 'belt' || Math.abs(v) < 0.005) return;
    const p = this.w.com(it.name, this.p), y1 = Math.min(BELT.y1, p[1] + v * AHEAD), L = y1 - p[1];
    if (L <= 0.002) return;
    this.line.scale.set(1, L, 1);
    this.line.position.set(p[0], (p[1] + y1) / 2, BELT.top + 0.0015);
    this.dot.position.set(p[0], y1, BELT.top + 0.0015);
    this.line.visible = this.dot.visible = true;
  }

  show(fx, color) {
    const b = this.bins[fx]; if (!b) return;
    b.outline.userData.mat.color.setHex(color);
    b.outline.visible = true;
  }
}

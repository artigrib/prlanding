// "Rozložený pohled / Jak se skládá": exploded view of the SO-101 (printed parts vs. bought servos),
// part names on hover / tap, and a step-by-step assembly animation.
// Order follows the SO-101 assembly guide (huggingface.co/docs/lerobot/so101: Joint 1 … Joint 5, Gripper),
// simplified to the parts that exist in the model.

const PARTS = {
  base_so101_v2: ['Základna', true],
  base_motor_holder_so101_v1: ['Držák serva v základně', true],
  waveshare_mounting_plate_so101_v2: ['Destička pro řídicí desku', true],
  motor_holder_so101_base_v1: ['Držák serva ramene', true],
  rotation_pitch_so101_v1: ['Otočný díl ramene', true],
  upper_arm_so101_v1: ['Horní rameno', true],
  under_arm_so101_v1: ['Předloktí', true],
  motor_holder_so101_wrist_v1: ['Držák serva zápěstí', true],
  wrist_roll_pitch_so101_v2: ['Kloub zápěstí', true],
  wrist_roll_follower_so101_v1: ['Pevná čelist chapadla', true],
  moving_jaw_so101_v1: ['Pohyblivá čelist', true],
  wrist_roll_follower_so101_camera_mount: ['Držák kamery (volitelný)', true],
  sts3215_03a_v1: ['Servo Feetech STS3215', false],
  sts3215_03a_no_horn_v1: ['Servo Feetech STS3215', false]
};
const SERVO_NO = { base: 1, shoulder: 2, upper_arm: 3, lower_arm: 4, wrist: 5, gripper: 6 };

// [title, [[body, mesh], ...]]
const STEPS = [
  ['Kloub 1: servo 1 do základny', [['base', 'base_so101_v2'], ['base', 'sts3215_03a_v1']]],
  ['Kloub 1: držák serva přes servo', [['base', 'base_motor_holder_so101_v1']]],
  ['Rameno: otočný díl a držák serva 2', [['shoulder', 'rotation_pitch_so101_v1'], ['shoulder', 'motor_holder_so101_base_v1']]],
  ['Kloub 2: servo 2 a horní rameno', [['shoulder', 'sts3215_03a_v1'], ['upper_arm', 'upper_arm_so101_v1']]],
  ['Kloub 3: servo 3 a předloktí', [['upper_arm', 'sts3215_03a_v1'], ['lower_arm', 'under_arm_so101_v1']]],
  ['Kloub 4: držák 4 a servo 4', [['lower_arm', 'motor_holder_so101_wrist_v1'], ['lower_arm', 'sts3215_03a_v1']]],
  ['Kloub 5: servo 5 do kloubu zápěstí', [['wrist', 'sts3215_03a_no_horn_v1'], ['wrist', 'wrist_roll_pitch_so101_v2']]],
  ['Chapadlo: pevná čelist a servo 6', [['gripper', 'wrist_roll_follower_so101_v1'], ['gripper', 'sts3215_03a_v1']]],
  ['Chapadlo: pohyblivá čelist', [['moving_jaw_so101_v1', 'moving_jaw_so101_v1']]],
  ['Nakonec: destička pro řídicí desku', [['base', 'waveshare_mounting_plate_so101_v2']]]
];
const DISPLAY_POSE = [0.35, -0.55, 0.35, 0.75, 0, 0.35];

export class Explode {
  constructor(ux) {
    this.ux = ux; this.app = ux.app; this.T = ux.T;
    const { mj, app } = ux, m = app.m;
    const name = (t, i) => mj.mj_id2name(m, mj.mjtObj[t].value, i);
    const armBodies = new Set(ux.ctl.kin.c.bodies.map((b) => b.id));
    this.parts = [];
    const add = (g, mesh) => {
      const b = m.geom_bodyid[g], mn = name('mjOBJ_MESH', m.geom_dataid[g]), info = PARTS[mn];
      if (!info) return;
      const bn = name('mjOBJ_BODY', b);
      const label = info[1] ? `${info[0]} – tištěný díl` : `${info[0]} (č. ${SERVO_NO[bn] || ''}) – kupovaný díl`;
      this.parts.push({ g, mesh, body: b, bname: bn, mname: mn, printed: info[1], label, c: new Float64Array(3), off: new Float64Array(3), f: 1, step: -1 });
    };
    for (const [g, mesh] of app.geoms) if (armBodies.has(m.geom_bodyid[g]) && m.geom_type[g] === 7) add(g, mesh);
    for (const [g, mesh] of ux.cameras.mountMeshes) add(g, mesh);
    STEPS.forEach(([, list], k) => {
      for (const [bn, mn] of list) {
        const p = this.parts.find((x) => x.step < 0 && x.bname === bn && x.mname === mn);
        if (p) p.step = k;
      }
    });
    this.nPrinted = this.parts.filter((p) => p.printed && p.mname !== 'wrist_roll_follower_so101_camera_mount').length;
    this.nServo = this.parts.filter((p) => !p.printed).length;
    this.on = false; this.amount = 0; this.want = 0; this.play = null;
    this.bodyC = new Map(); this.arm = new Float64Array(3);
    this.v = new this.T.Vector3();
    this.hl = { printed: new this.T.MeshStandardMaterial({ color: 0xe8461e, roughness: 0.45, emissive: 0xe8461e, emissiveIntensity: 0.25 }),
      servo: new this.T.MeshStandardMaterial({ color: 0x1f3bff, roughness: 0.45, emissive: 0x1f3bff, emissiveIntensity: 0.3 }) };
    this.ray = new this.T.Raycaster(); this.ndc = new this.T.Vector2();
    this.ui();
    this.bind();
  }

  ui() {
    const st = this.ux.panel.stage;
    const el = this.el = document.createElement('div');
    el.className = 'ux-explode'; el.hidden = true;
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Rozložený pohled');
    el.innerHTML = `<div class="ux-ex-top"><p class="mono">Z čeho se SO-101 skládá</p>
        <button type="button" class="ux-x" aria-label="Zavřít rozložený pohled">×</button></div>
      <div class="jn"><label for="ux-ex-r">Rozložení</label><output for="ux-ex-r" id="ux-ex-o"></output>
        <input type="range" id="ux-ex-r" min="0" max="100" step="1"></div>
      <ul class="ux-ex-leg">
        <li><i class="pr" aria-hidden="true"></i><span><b>${this.nPrinted} tištěných dílů</b> – vytiskneme je pro vás</span></li>
        <li><i class="sv" aria-hidden="true"></i><span><b>${this.nServo}× servo Feetech STS3215</b> – kupované, plus řídicí deska, kabely a šrouby M2/M3</span></li>
      </ul>
      <p class="ux-ex-hover mono-s" aria-live="polite">Najeďte nebo klepněte na díl a uvidíte jeho název.</p>
      <div class="ux-ex-b">
        <button type="button" class="btn btn-o" id="ux-ex-play">Jak se skládá <span aria-hidden="true">▶</span></button>
        <a class="btn btn-act" href="../../sada/so101/">Tyto díly vám vytiskneme <span aria-hidden="true">→</span></a>
      </div>
      <p class="ux-ex-step" id="ux-ex-step" aria-live="polite" hidden></p>
      <p class="mono-s muted ux-ex-note">Pořadí podle montážního návodu SO-101 (LeRobot), zjednodušeně – jen díly, které jsou v modelu.</p>`;
    st.appendChild(el);
    this.tip = document.createElement('div'); this.tip.className = 'ux-ex-tip'; this.tip.hidden = true;
    st.appendChild(this.tip);
    this.range = el.querySelector('#ux-ex-r');
    this.range.addEventListener('input', () => { this.stopPlay(); this.want = this.amount = +this.range.value / 100; this.showAmount(); });
    el.querySelector('.ux-x').addEventListener('click', () => { this.toggle(); this.ux.panel.showExplode(false); });
    el.querySelector('#ux-ex-play').addEventListener('click', () => (this.play ? this.stopPlay() : this.startPlay()));
    this.hoverEl = el.querySelector('.ux-ex-hover');
    this.stepEl = el.querySelector('#ux-ex-step');
  }
  showAmount() { this.range.value = Math.round(this.amount * 100); this.el.querySelector('#ux-ex-o').textContent = Math.round(this.amount * 100) + ' %'; }

  toggle() {
    this.on = !this.on;
    const ux = this.ux;
    if (this.on) {
      ux.ctl.cancel(); ux.pending = null; ux.teach.stopReplay();
      DISPLAY_POSE.forEach((v, i) => ux.app.setCtrl(i, v));
      ux.gizmo.enabled = false;
      this.want = 0.8; this.el.hidden = false;
      ux.panel.stage.classList.add('ux-exploding');
      ux.cameras.frameArm();
    } else {
      this.stopPlay(); this.want = 0; this.el.hidden = true; this.tip.hidden = true; this.unhover();
      ux.gizmo.enabled = true; ux.ctl.syncFromCtrl();
      ux.panel.stage.classList.remove('ux-exploding');
    }
    return this.on;
  }

  startPlay() {
    this.play = { k: -1, t: 0 };
    this.el.querySelector('#ux-ex-play').firstChild.textContent = 'Zastavit ';
    this.stepEl.hidden = false;
    this.nextStep();
  }
  stopPlay() {
    if (!this.play) return;
    this.play = null;
    for (const p of this.parts) { p.mesh.visible = !(p.mname === 'wrist_roll_follower_so101_camera_mount' && !this.ux.cameras.wristOn); p.f = 1; }
    this.el.querySelector('#ux-ex-play').firstChild.textContent = 'Jak se skládá ';
    this.stepEl.hidden = true;
  }
  nextStep() {
    const P = this.play; P.k++; P.t = 0;
    if (P.k >= STEPS.length) { this.stopPlay(); this.want = this.amount = 0; this.showAmount(); this.stepEl.hidden = false; this.stepEl.textContent = 'Hotovo – ruka je složená. Teď ještě kabely a kalibrace.'; return; }
    this.stepEl.textContent = `Krok ${P.k + 1} / ${STEPS.length}: ${STEPS[P.k][0]}`;
  }

  /** per frame, after app.sync() wrote the assembled poses into mesh.matrix */
  tick() {
    // wall-clock step: animations keep their speed even when frames are slow
    const now = performance.now(), dt = Math.min(0.25, (now - (this.lastT || now)) / 1000); this.lastT = now;
    if (!this.on && this.amount <= 0.0005 && !this.play) return;
    if (this.play) {
      const P = this.play, dur = this.ux.reduced ? 0.01 : 0.9;
      P.t += dt;
      const k = Math.min(1, P.t / dur), e = 1 - Math.pow(1 - k, 3);
      for (const p of this.parts) {
        if (p.step < P.k) { p.mesh.visible = p.step >= 0 || p.mname !== 'wrist_roll_follower_so101_camera_mount'; p.f = 0; }
        else if (p.step === P.k) { p.mesh.visible = true; p.f = 1 - e; }
        else p.mesh.visible = false;
      }
      this.amount = 1;
      if (P.t > dur + (this.ux.reduced ? 1.6 : 0.8)) this.nextStep();
    } else {
      const a = this.amount += (this.want - this.amount) * Math.min(1, dt * (this.ux.reduced ? 60 : 6));
      if (Math.abs(this.want - a) < 0.001) this.amount = this.want;
      for (const p of this.parts) p.f = 1;
      if (this.on && document.activeElement !== this.range) this.showAmount();
    }
    this.offsets();
  }

  offsets() {
    const T = this.parts, bc = this.bodyC, arm = this.arm;
    arm.fill(0); bc.clear();
    for (const p of T) {
      const e = p.mesh.matrix.elements, geo = p.mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const c = geo.boundingSphere.center;
      p.c[0] = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12];
      p.c[1] = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13];
      p.c[2] = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
      let b = bc.get(p.body); if (!b) { b = [0, 0, 0, 0]; bc.set(p.body, b); }
      b[0] += p.c[0]; b[1] += p.c[1]; b[2] += p.c[2]; b[3]++;
      arm[0] += p.c[0]; arm[1] += p.c[1]; arm[2] += p.c[2];
    }
    for (let i = 0; i < 3; i++) arm[i] /= T.length;
    const a = this.amount;
    for (const p of T) {
      const b = bc.get(p.body), n = b[3];
      const s = a * p.f;
      for (let i = 0; i < 3; i++) {
        const bcen = b[i] / n;
        p.off[i] = s * (1.1 * (bcen - arm[i]) + 2.4 * (p.c[i] - bcen)) + (i === 2 ? s * 0.04 : 0);
      }
      const e = p.mesh.matrix.elements;
      e[12] += p.off[0]; e[13] += p.off[1]; e[14] += p.off[2];
      p.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  // ---------- labels ----------
  bind() {
    const canvas = this.app.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      if (!this.on || e.pointerType !== 'mouse' || e.buttons) return;
      const now = performance.now(); if (now - (this.ht || 0) < 60) return; this.ht = now;
      this.hoverAt(e);
    });
    canvas.addEventListener('pointerleave', () => { if (this.on) { this.unhover(); this.tip.hidden = true; } });
    canvas.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.on || !this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) return;
      this.hoverAt(e);
    });
  }
  hoverAt(e) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.app.camera);
    this.app.world.updateMatrixWorld();
    const list = this.parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
    // the low-detail physics meshes are plenty for picking (fast); fall back to the shown geometry
    const hits = this.ray.intersectObjects(list, false);
    const p = hits.length ? this.parts.find((x) => x.mesh === hits[0].object) : null;
    if (p !== this.hovered) {
      this.unhover();
      if (p) { this.hovered = p; p.mat = p.mesh.material; p.mesh.material = p.printed ? this.hl.printed : this.hl.servo; }
    }
    if (p) {
      const st = this.ux.panel.stage.getBoundingClientRect();
      this.tip.textContent = p.label; this.tip.hidden = false;
      this.tip.className = 'ux-ex-tip ' + (p.printed ? 'pr' : 'sv');
      const x = Math.min(e.clientX - st.left + 14, st.width - this.tip.offsetWidth - 8);
      this.tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, e.clientY - st.top - 36)}px)`;
      this.hoverEl.textContent = p.label;
    } else this.tip.hidden = true;
  }
  unhover() { const p = this.hovered; if (p) { p.mesh.material = p.mat; this.hovered = null; } }
}

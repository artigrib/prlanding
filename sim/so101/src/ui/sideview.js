// "Pohled z boku": a small orthographic side view in the bottom-left corner (above the camera toggle) with the
// gripper, the mission's target object and the measured height (src/sidegeom.js). HUD stage 3.
// Cost: the view is drawn into a small render target at reduced resolution, only when the arm or the target moved
// and at most every SKIP-th frame; every frame only blits that texture into the corner (one textured quad).

import { sideTarget, measure, heightText, sideLabel, sideFrame, toInset } from '../sidegeom.js';
import { inZone } from '../missions.js';
import { GRASP } from '../missions.js';
import { store } from './store.js';

const SKIP = 3;          // redraw at most every 3rd frame (≈ 20 Hz at 60 fps)
const RES = 0.75;        // render target pixels per CSS px (at most; × devicePixelRatio, capped at 1)
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/** Default on, phones included: the rule was "phones only if it costs < 10 % fps". Measured under swiftshader
 *  (render + gl.readPixels per frame, arm moving = one redraw in 3 frames): 1440×900 −3.1 %, e2e phone 390×844
 *  −3.5 % (idle, blit only: −1.3 % / −2.2 %). On a 390×844 phone the inset sits in the empty bottom-left corner. */
export function sideDefault() { return true; }

export class SideView {
  constructor(ux) {
    const T = this.T = ux.T;
    this.ux = ux; this.app = ux.app;
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.001, 2);
    this.cam.up.set(0, 1, 0);
    this.rt = null;
    this.sig = ''; this.frame = 0; this.last = -99; this.size = new T.Vector2();
    this.tipBuf = new Float64Array(3);
    // blit: the render target's texture on one quad
    this.bScene = new T.Scene();
    this.bCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bMat = new T.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false });
    this.bScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.bMat));
    this.v3 = new T.Vector3();
    this.on = store.get('side', null);
    if (this.on == null) this.on = sideDefault();
    this.el = h(`<figure class="ux-side" role="img" aria-label="Pohled z boku" hidden>
      <figcaption class="mono-s" aria-hidden="true"><span class="ux-side-k"><span>Z boku</span> · </span><span class="ux-side-n"></span></figcaption>
      <svg class="ux-side-svg" aria-hidden="true" focusable="false"><line class="ux-side-lv"/><line class="ux-side-lh"/><circle class="ux-side-tip" r="3.5"/></svg>
      <span class="ux-side-h mono" aria-hidden="true"></span>
    </figure>`);
    ux.panel.stage.appendChild(this.el);
    this.nameEl = this.el.querySelector('.ux-side-n');
    this.hEl = this.el.querySelector('.ux-side-h');
    this.lv = this.el.querySelector('.ux-side-lv'); this.lh = this.el.querySelector('.ux-side-lh'); this.dot = this.el.querySelector('.ux-side-tip');
    this.show();
  }

  set(on) { this.on = !!on; store.set('side', this.on); this.show(); }
  show() {
    this.el.hidden = !this.on;
    this.ux.panel.stage.classList.toggle('ux-side-on', this.on);
    this.rect = null; this.sig = ''; this.ux.panel.pipCache = null;
  }

  /** inset rectangle in canvas CSS px (cached until the canvas size changes) */
  rectOf() {
    if (this.el.hidden || !this.el.offsetParent) return null;
    const c = this.app.renderer.domElement;
    if (!this.rect || this.rect.cw !== c.clientWidth || this.rect.ch !== c.clientHeight) {
      const a = c.getBoundingClientRect(), b = this.el.getBoundingClientRect();
      this.rect = { cw: c.clientWidth, ch: c.clientHeight, x: Math.round(b.left - a.left + 1), y: Math.round(b.top - a.top + 1), w: Math.round(b.width - 2), h: Math.round(b.height - 2) };
      if (this.rect.w < 8 || this.rect.h < 8) this.rect = null;
    }
    return this.rect;
  }

  /** what the inset shows now: target, tip, measurement; null when there is nothing to frame */
  state() {
    const ux = this.ux, tip = ux.ctl.actualTip(this.tipBuf);
    const t = ux.workTarget ? ux.workTarget() : sideTarget(ux.world, ux.runner.m, ux.heldObject(), tip, inZone);   // the trackpad's selection first
    if (!t) return null;
    return { t, tip, ...measure(tip, t.p) };
  }

  /** called by Cameras.render() after the main view */
  render(r) {
    this.frame++;
    if (!this.on) return;
    const rect = this.rectOf(); if (!rect) return;
    const st = this.state();
    const d = this.app.d, q = d.qpos;
    // redraw when the arm, the gripper or the target moved (1 mm / 0.01 rad steps), at most every SKIP-th frame
    const sig = st ? [st.tip[0], st.tip[1], st.tip[2], st.t.p[0], st.t.p[1], st.t.p[2]].map((v) => Math.round(v * 1000)).join(',') + '|' + st.t.name
      + '|' + [0, 1, 2, 3, 4, 5].map((i) => Math.round(q[i] * 100)).join(',') + '|' + rect.w + 'x' + rect.h : 'none';
    const due = sig !== this.sig && this.frame - this.last >= SKIP;
    if (due || !this.rt) { this.draw(r, rect, st); this.sig = sig; this.last = this.frame; this.drawn = (this.drawn || 0) + 1; }
    this.blit(r, rect);
  }

  draw(r, rect, st) {
    const T = this.T, pr = Math.min(1, RES * r.getPixelRatio()), w = Math.max(16, Math.round(rect.w * pr)), hh = Math.max(16, Math.round(rect.h * pr));
    if (!this.rt) {
      this.rt = new T.WebGLRenderTarget(w, hh, { depthBuffer: true });
      this.rt.texture.colorSpace = T.SRGBColorSpace;
      this.bMat.map = this.rt.texture; this.bMat.needsUpdate = true;
    } else if (this.rt.width !== w || this.rt.height !== hh) this.rt.setSize(w, hh);
    const aspect = rect.w / rect.h;
    if (!st) { this.overlay(null); r.setRenderTarget(this.rt); r.setClearColor(0xdcdcd6, 1); r.clear(); r.setRenderTarget(null); r.setClearColor(0x000000, 0); return; }
    const f = sideFrame(st.tip, st.t.p, aspect), c = this.cam;
    // MuJoCo (x, y, z) → three (x, z, −y)
    const cx = f.centre[0] + f.u[0] * f.front, cy = f.centre[1] + f.u[1] * f.front, cz = f.centre[2];
    c.position.set(cx, cz, -cy);
    c.lookAt(this.v3.set(f.centre[0], f.centre[2], -f.centre[1]));
    c.left = -f.halfW; c.right = f.halfW; c.top = f.halfH; c.bottom = -f.halfH;
    c.near = 0.001; c.far = f.front + f.back;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    // the real scene only: no gizmo, path preview or drop line
    const g = this.ux.gizmo, vis = [g.root.visible, g.ghost.visible, g.drop.visible, g.foot.visible];
    g.root.visible = g.ghost.visible = g.drop.visible = g.foot.visible = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(0xdcdcd6, 1); r.clear();
    r.render(this.app.scene, c);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 0);
    [g.root.visible, g.ghost.visible, g.drop.visible, g.foot.visible] = vis;
    this.overlay(st, f, rect);
  }

  /** the texture into the corner (scissor), every frame */
  blit(r, rect) {
    r.getSize(this.size);
    const y = this.size.y - rect.y - rect.h;
    r.setScissorTest(true);
    r.setScissor(rect.x, y, rect.w, rect.h); r.setViewport(rect.x, y, rect.w, rect.h);
    const ac = r.autoClear; r.autoClear = false;
    r.render(this.bScene, this.bCam);
    r.autoClear = ac;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
  }

  /** height line, tip dot, label and the accessible name (written only on change) */
  overlay(st, f, rect) {
    const el = this.el;
    if (!st) {
      this.lv.style.display = this.lh.style.display = this.dot.style.display = 'none'; this.hEl.textContent = '';
      if (this.nameTxt !== '') { this.nameEl.textContent = ''; this.nameTxt = ''; el.setAttribute('aria-label', 'Pohled z boku'); }
      return;
    }
    const [tx, ty] = toInset(f, st.tip, rect.w, rect.h), [, py] = toInset(f, st.t.p, rect.w, rect.h), [px] = toInset(f, st.t.p, rect.w, rect.h);
    const a = (e, k, v) => e.setAttribute(k, v.toFixed(1));
    this.lv.style.display = this.lh.style.display = this.dot.style.display = '';
    a(this.lv, 'x1', tx); a(this.lv, 'y1', ty); a(this.lv, 'x2', tx); a(this.lv, 'y2', py);
    a(this.lh, 'x1', Math.min(tx, px) - 14); a(this.lh, 'y1', py); a(this.lh, 'x2', Math.max(tx, px) + 14); a(this.lh, 'y2', py);
    a(this.dot, 'cx', tx); a(this.dot, 'cy', ty);
    const okH = st.dz > -GRASP.dz && st.dz < GRASP.top;   // same band as heightText (src/sidegeom.js)
    el.classList.toggle('ok', okH);
    const txt = heightText(st.dz);
    if (txt !== this.hTxt) { this.hEl.textContent = txt; this.hTxt = txt; }
    // label next to the middle of the line, kept inside the inset
    const lx = Math.max(4, Math.min(rect.w - 64, tx + 8)), ly = Math.max(18, Math.min(rect.h - 22, (ty + py) / 2 - 9));
    this.hEl.style.transform = `translate(${lx.toFixed(0)}px,${ly.toFixed(0)}px)`;
    if (st.t.label !== this.nameTxt) { this.nameEl.textContent = st.t.label; this.nameTxt = st.t.label; }
    const lab = sideLabel(st.dz, st.dh, st.t.label);
    if (lab !== this.ariaTxt) { el.setAttribute('aria-label', lab); this.ariaTxt = lab; }
  }
}

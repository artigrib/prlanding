// Confetti on success: 2D canvas overlay, preallocated particles, skipped with prefers-reduced-motion.

const N = 180;
const COLS = ['#E8461E', '#1F3BFF', '#0E0E0E', '#F2F2EE', '#9A9A94'];

export class Confetti {
  constructor(stage, reduced) {
    this.reduced = reduced;
    const c = this.c = document.createElement('canvas');
    c.className = 'ux-confetti'; c.setAttribute('aria-hidden', 'true');
    stage.appendChild(c);
    this.g = c.getContext('2d');
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.vx = new Float32Array(N); this.vy = new Float32Array(N);
    this.a = new Float32Array(N); this.va = new Float32Array(N); this.s = new Float32Array(N); this.col = new Uint8Array(N);
    this.t = 0; this.on = false;
  }
  burst() {
    if (this.reduced) return;
    const r = this.c.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = r.width * dpr; this.c.height = r.height * dpr; this.dpr = dpr;
    this.w = r.width; this.h = r.height;
    for (let i = 0; i < N; i++) {
      const left = i % 2 === 0;
      this.x[i] = left ? 0 : this.w; this.y[i] = this.h * (0.55 + Math.random() * 0.3);
      const sp = 380 + Math.random() * 520, ang = (left ? -1 : -1) * (Math.PI / 2 - (left ? -1 : 1) * (0.25 + Math.random() * 0.55));
      this.vx[i] = Math.cos(ang) * sp * (left ? 1 : 1); this.vy[i] = Math.sin(ang) * sp;
      if (!left) this.vx[i] = -Math.abs(this.vx[i]); else this.vx[i] = Math.abs(this.vx[i]);
      this.a[i] = Math.random() * 6; this.va[i] = (Math.random() - 0.5) * 14; this.s[i] = 5 + Math.random() * 6;
      this.col[i] = (Math.random() * COLS.length) | 0;
    }
    this.t = 0; this.on = true; this.c.hidden = false;
  }
  clear() { if (!this.on) return; this.on = false; this.g.clearRect(0, 0, this.w || 0, this.h || 0); this.c.hidden = true; }
  tick(dt) {
    if (!this.on) return;
    this.t += dt;
    const g = this.g; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, this.w, this.h);
    const fade = this.t > 2.4 ? Math.max(0, 1 - (this.t - 2.4) / 0.8) : 1;
    g.globalAlpha = fade;
    for (let i = 0; i < N; i++) {
      this.vy[i] += 900 * dt; this.vx[i] *= 1 - 1.2 * dt; this.vy[i] *= 1 - 0.8 * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.a[i] += this.va[i] * dt;
      const s = this.s[i];
      g.fillStyle = COLS[this.col[i]];
      g.save(); g.translate(this.x[i], this.y[i]); g.rotate(this.a[i]);
      g.fillRect(-s / 2, -s / 4, s, s / 2 * Math.abs(Math.cos(this.a[i] * 1.7)) + 1);
      g.restore();
    }
    if (fade <= 0) { this.on = false; g.clearRect(0, 0, this.w, this.h); this.c.hidden = true; }
  }
}

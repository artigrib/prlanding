// Highlight clip: records the WebGL canvas with MediaRecorder (WebM). Optional feature: the button is
// hidden on browsers without canvas.captureStream / MediaRecorder / a WebM codec.
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function clipType() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const t of TYPES) try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (_) { /* ignore */ }
  return null;
}

export class ClipRecorder {
  constructor(canvas, fps = 30) { this.canvas = canvas; this.fps = fps; this.rec = null; this.parts = []; }
  get active() { return !!this.rec; }
  start() {
    const type = clipType();
    if (!type) throw new Error('Nahrávání videa tento prohlížeč neumí.');
    const stream = this.canvas.captureStream(this.fps);
    this.parts = [];
    const bps = Math.min(6e6, Math.max(1.5e6, this.canvas.width * this.canvas.height * 2));
    try { this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bps }); } catch (_) { stream.getTracks().forEach(t => t.stop()); throw new Error('Nahrávání videa tento prohlížeč neumí.'); }
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.parts.push(e.data); };
    this.done = new Promise((res, rej) => {
      this.rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(this.parts, { type: 'video/webm' })); };
      this.rec.onerror = e => { stream.getTracks().forEach(t => t.stop()); this.rec = null; rej(new Error('Nahrávání klipu selhalo.')); };
    });
    this.done.catch(() => {});        // a failure is reported by stop(), never as an unhandled rejection
    this.rec.start(250);
  }
  stop() {
    if (!this.rec) return Promise.resolve(null);
    const r = this.rec; this.rec = null;
    if (r.state !== 'inactive') r.stop();
    return this.done;
  }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

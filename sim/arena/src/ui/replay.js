// Replay player UI: timeline with event markers, play / pause, speed, cameras (auto director, TV, chase,
// top, FPV, free orbit), robot to follow, save (.prreplay), highlight clip (WebM). Czech, touch-friendly.
import { Playback, Director, SPEEDS } from '../replay/player.js';
import { serialize } from '../replay/codec.js';
import { ClipRecorder, clipType, download } from '../replay/clip.js';

// optional backend hook for short links: replayHooks.upload = async (blob, header) => 'https://…'
export const replayHooks = { upload: null };

export const REPLAY_CAMS = [
  { id: 'auto', name: 'Režisér' }, { id: 'tv', name: 'TV přenos' }, { id: 'chase', name: 'Za robotem' },
  { id: 'top', name: 'Shora' }, { id: 'fpv', name: 'Z robota' }, { id: 'free', name: 'Volná' }
];
const MARK = Object.freeze({ hit: 'Zásah', flip: 'Převrácení', pit: 'Jáma', out: 'Mimo arénu', ko: 'K.O.', wheel: 'Upadlé kolo', sep: 'Oddělení' });
const markOf = t => (Object.prototype.hasOwnProperty.call(MARK, t) ? MARK[t] : null);
const fmt = s => { s = Math.max(0, s); const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${m}:${String(x).padStart(2, '0')}`; };
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

export function createReplayUI(d) {
  const $ = id => document.getElementById(id);
  const el = {
    root: $('replay-ui'), title: $('rp-title'), slow: $('rp-slow'), time: $('rp-time'), scrub: $('rp-scrub'), marks: $('rp-marks'),
    play: $('rp-play'), speed: $('rp-speed'), cam: $('rp-cam'), focus: $('rp-focus'), prev: $('rp-prev'), next: $('rp-next'),
    save: $('rp-save'), clip: $('rp-clip'), link: $('rp-link'), slowopt: $('rp-slowopt'), close: $('skip'), msg: $('rp-msg')
  };
  let pb = null, opts = null, cam = 'auto', focus = 0, clip = null, scrubbing = false, closing = false;
  const director = new Director();
  const free = { angle: 0.6, height: 2.0, radius: 4.2 };

  // ---- controls
  SPEEDS.forEach(s => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = String(s).replace('.', ',') + '×';
    b.dataset.s = s; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', `Rychlost ${String(s).replace('.', ',')}×`);
    b.onclick = () => setSpeed(s); el.speed.appendChild(b);
  });
  function setSpeed(s) { if (!pb) return; pb.speed = s; for (const b of el.speed.children) b.setAttribute('aria-pressed', String(+b.dataset.s === s)); }
  function setPlaying(on) {
    if (!pb) return;
    if (on && pb.t >= pb.to - 1e-3) pb.seek(pb.from);
    pb.playing = on;
    el.play.textContent = on ? '❚❚' : '▶'; el.play.setAttribute('aria-label', on ? 'Pozastavit' : 'Přehrát');
  }
  function setCam(id) {
    cam = id; const c = REPLAY_CAMS.find(x => x.id === id);
    el.cam.querySelector('span').textContent = c.name;
    el.focus.disabled = id === 'auto' || id === 'tv' || id === 'top';
    if (id === 'auto') director.reset();
  }
  function setFocus(i) { focus = i; el.focus.querySelector('span').textContent = (d.names()[i] || ''); }
  el.play.onclick = () => setPlaying(!pb.playing);
  el.cam.onclick = () => { const i = REPLAY_CAMS.findIndex(c => c.id === cam); setCam(REPLAY_CAMS[(i + 1) % REPLAY_CAMS.length].id); };
  el.focus.onclick = () => setFocus(1 - focus);
  el.slowopt.onchange = () => { if (pb) pb.autoSlow = el.slowopt.checked; };
  el.prev.onclick = () => jump(-1); el.next.onclick = () => jump(1);
  el.close.onclick = () => close('user');
  el.scrub.addEventListener('input', () => { if (!pb) return; scrubbing = true; pb.seek(pb.from + (pb.to - pb.from) * el.scrub.value / 1000); paint(); });
  el.scrub.addEventListener('change', () => { scrubbing = false; });
  el.save.onclick = async () => {
    if (!pb) return;
    try {
      const bytes = await serialize(pb.track, opts.header);
      download(new Blob([bytes], { type: 'application/octet-stream' }), `zapas-${stamp()}.prreplay`);
      say(`Záznam uložen (${Math.round(bytes.length / 1024)} kB).`);
    } catch (e) { say('Záznam se nepodařilo uložit.'); }
  };
  el.link.onclick = async () => {
    if (!pb || !replayHooks.upload) return;
    try {
      const bytes = await serialize(pb.track, opts.header);
      const url = await replayHooks.upload(new Blob([bytes]), opts.header);
      if (navigator.share) await navigator.share({ title: 'Záznam z arény 150 g', url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); say('Odkaz zkopírován.'); }
    } catch (e) { say('Odkaz se nepodařilo vytvořit.'); }
  };
  el.clip.onclick = () => (clip ? stopClip(false) : startClip());

  // free orbit: drag to look around, wheel / pinch to zoom
  const ptrs = new Map();
  let pinch = 0;
  const canvas = d.canvas;
  canvas.addEventListener('pointerdown', e => { if (!pb) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) pinch = dist(); });
  addEventListener('pointerup', e => { ptrs.delete(e.pointerId); pinch = 0; });
  addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', e => {
    if (!pb || !ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    if (cam !== 'free') { const c = d.camPose(); free.angle = c.angle; setCam('free'); }
    if (ptrs.size === 2) { const n = dist(); if (pinch) free.radius = clampR(free.radius * pinch / n); pinch = n; return; }
    free.angle -= dx * 0.008; free.height = Math.max(0.25, Math.min(7, free.height + dy * 0.012));
  });
  canvas.addEventListener('wheel', e => { if (!pb) return; e.preventDefault(); if (cam !== 'free') setCam('free'); free.radius = clampR(free.radius * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  function dist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  const clampR = r => Math.max(1.2, Math.min(14, r));

  function jump(dir) {
    if (!pb) return;
    const ev = pb.track.events.filter(e => markOf(e.type) && e.t >= pb.from && e.t <= pb.to);
    const t = pb.t;
    const e = dir > 0 ? ev.find(x => x.t - 1.2 > t + 0.05) : ev.slice().reverse().find(x => x.t - 1.2 < t - 0.6);
    if (e) { pb.seek(Math.max(pb.from, e.t - 1.2)); setPlaying(true); } else if (dir < 0) pb.seek(pb.from);
    paint();
  }
  function say(t) { el.msg.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { el.msg.textContent = ''; }, 4000); }

  async function startClip() {
    if (!pb || clip) return;
    try {
      clip = new ClipRecorder(canvas, d.touch ? 15 : 30);   // phones: lighter encode
      const len = Math.min(10, pb.to - pb.from);
      pb.seek(Math.max(pb.from, pb.to - len)); setSpeed(1); setPlaying(true);
      clip.start();
      el.clip.querySelector('span').textContent = 'Zastavit klip';
      el.root.classList.add('clipping');
      say('Nahrávám klip…');
    } catch (e) { clip = null; say(e.message || 'Nahrávání videa tento prohlížeč neumí.'); }
  }
  async function stopClip(cancel) {
    if (!clip) return;
    const c = clip; clip = null;
    el.clip.querySelector('span').textContent = 'Klip 10 s';
    el.root.classList.remove('clipping');
    try {
      const blob = await c.stop();
      if (cancel) return;
      if (blob && blob.size) { download(blob, `klip-${stamp()}.webm`); say(`Klip uložen (${Math.round(blob.size / 1024)} kB).`); }
      else say('Klip je prázdný – obraz se nenahrál. Nechte kartu otevřenou a zkuste to znovu.');
    } catch (e) { say('Klip se nepodařilo uložit.'); }
  }

  function buildMarks() {
    el.marks.innerHTML = '';
    const span = pb.to - pb.from || 1;
    for (const e of pb.track.events) {
      if (!markOf(e.type) || e.t < pb.from || e.t > pb.to) continue;
      if (e.type === 'hit' && (e.e || 0) < 0.35) continue;
      const m = document.createElement('i');
      m.className = 'mk ' + e.type + (e.type === 'hit' && e.e >= 0.7 ? ' big' : '');
      m.style.left = (100 * (e.t - pb.from) / span).toFixed(2) + '%';
      m.title = `${markOf(e.type)} · ${fmt(e.t)}`;
      el.marks.appendChild(m);
    }
  }
  function paint() {
    if (!pb) return;
    if (!scrubbing) el.scrub.value = String(Math.round(pb.progress() * 1000));
    el.time.textContent = `${fmt(pb.t - pb.from)} / ${fmt(pb.to - pb.from)}`;
    el.slow.hidden = !pb.slowed;
    el.play.textContent = pb.playing ? '❚❚' : '▶';
  }

  // ---- public API
  function open(o) {
    closing = false;
    try { return openInner(o); } catch (e) {
      // leave nothing half-open: the caller shows the error and navigates away
      if (pb) pb.playing = false;
      pb = null; opts = null; el.root.hidden = true;
      throw e;
    }
  }
  function openInner(o) {
    if (!o || !o.track || !o.track.chunks || !o.track.chunks.length) throw new Error('replay: empty track');
    opts = o;
    pb = new Playback(o.track, o.binding, d.scene);
    pb.onEvent = e => d.onEvent && d.onEvent(e, pb);
    pb.onEnd = () => {
      if (clip) stopClip(false);
      if (opts.autoClose) close('end');
    };
    pb.autoSlow = el.slowopt.checked;
    if (o.window) pb.window(o.window[0], o.window[1]); else pb.seek(pb.t0);
    el.title.textContent = o.title || 'Záznam';
    el.root.classList.toggle('instant', !!o.instant);
    el.save.hidden = !!o.noSave;
    el.link.hidden = !replayHooks.upload || !!o.noSave;
    el.clip.hidden = !clipType();
    setSpeed(o.speed || 1);
    setCam(o.cam || 'auto'); setFocus(o.focus || 0);
    director.reset();
    buildMarks();
    setPlaying(true);
    paint();
    el.root.hidden = false;
    return pb;
  }
  function close(reason) {
    if (!pb || closing) return;
    closing = true;
    if (clip) stopClip(true);
    const o = opts; pb.playing = false; pb = null;
    el.root.hidden = true;
    d.onClose && d.onClose(reason, o);
  }
  function tick(dt) {
    if (!pb) return;
    pb.tick(dt);
    if (clip && !pb.playing) stopClip(false);
    paint();
  }
  // camera request for main.js: { mode, focus, center?, orbit? }
  function camera(dt) {
    if (!pb) return null;
    if (cam === 'auto') {
      const s = director.update(dt, pb, pb.binding);
      return { mode: s.mode, focus: s.focus, center: s.center, orbit: s.mode === 'orbit' ? { radius: 3.2, height: 1.5, angle: director.angle += dt * 0.25 } : null };
    }
    if (cam === 'free') return { mode: 'orbit', focus, follow: true, orbit: { radius: free.radius, height: free.height, angle: free.angle } };
    return { mode: cam, focus };
  }
  function key(e) {
    if (!pb) return false;
    const c = e.code;
    if (c === 'Space' || c === 'KeyK') { setPlaying(!pb.playing); return true; }
    if (c === 'Escape') { close('user'); return true; }
    if (c === 'ArrowLeft' || c === 'KeyJ') { pb.seek(pb.t - 2); paint(); return true; }
    if (c === 'ArrowRight' || c === 'KeyL') { pb.seek(pb.t + 2); paint(); return true; }
    if (c === 'Comma') { jump(-1); return true; }
    if (c === 'Period') { jump(1); return true; }
    if (c === 'KeyC') { el.cam.click(); return true; }
    if (c === 'KeyF') { el.focus.click(); return true; }
    if (/^Digit[1-4]$/.test(c)) { setSpeed(SPEEDS[+c.slice(5) - 1]); return true; }
    return false;
  }
  return {
    open, close, tick, camera, key,
    get active() { return !!pb; }, get playback() { return pb; }, get cam() { return cam; },
    setCam, setSpeed, setPlaying, startClip, stopClip
  };
}

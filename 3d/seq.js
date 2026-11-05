// /3d/ main path: pre-rendered flythrough frames scrubbed by scroll on a 2D canvas (no WebGL).
// Frames come from the live flythrough (fly.js) via tools/seq/record.mjs; ?live forces the WebGL version.
import {loadOrder, scrollU, frameFor, nearest} from './seq-core.mjs';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const [G, M] = await Promise.all(['groups.json', 'seq/manifest.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d', {alpha: false});
const secs = [...document.querySelectorAll('.t')], N = secs.length - 1;

document.querySelectorAll('.t').forEach(sec => {
  const g = G[+sec.dataset.i], m = sec.querySelector('.meta');
  if (!g || !m) return;
  m.innerHTML = `<b>${g.models.map(x => x.name).join(' · ')}</b>` +
    (g.count ? `${g.key === 'mix' ? '' : 'Kategorie: '}${g.label} · ${g.count} projektů` : `${g.label} · ${g.models.length} modely`);
});

const set = M[innerWidth < 700 ? 'mobile' : 'desktop'];
const F = set.frames, img = new Array(F), have = new Array(F).fill(false);
const url = i => `seq/${set.dir}/${String(i).padStart(3, '0')}.webp`;
let shown = -1, want = 0, covered = false;
const stats = window.__seq = {set: set.dir, frames: F, loaded: 0, draws: 0, shown: -1};

function size() {
  const d = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(innerWidth * d); canvas.height = Math.round(innerHeight * d); shown = -1;
}
function draw() {
  if (covered) return;
  const i = nearest(want, have);
  if (i < 0 || i === shown) return;
  const im = img[i], cw = canvas.width, ch = canvas.height, s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
  const w = im.naturalWidth * s, h = im.naturalHeight * s;
  ctx.fillStyle = '#f4f4f1'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
  shown = stats.shown = i; stats.draws++;
}
let centers = [];
const measure = () => { centers = secs.map(e => { const b = e.getBoundingClientRect(); return b.top + scrollY + b.height / 2; }); };
const bar = document.getElementById('bar');
function update() {
  if (bar) bar.style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight) * 100) + '%';
  want = frameFor(scrollU(scrollY + innerHeight / 2, centers, RM), N, F); draw();
}
let raf = 0;
const tick = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
addEventListener('scroll', tick, {passive: true});
addEventListener('resize', () => { size(); measure(); tick(); });
new ResizeObserver(() => { measure(); tick(); }).observe(document.body);
new IntersectionObserver(([e]) => { covered = e.isIntersecting && e.boundingClientRect.top <= 0 && e.boundingClientRect.bottom >= innerHeight; if (!covered) { shown = -1; tick(); } },
  {threshold: [0, .5, .98, 1]}).observe(document.getElementById('ag'));
size(); measure(); update();

// progressive preload: first / last / middle, then fill gaps; reduced motion only needs the thesis frames
const order = RM ? [...new Set(secs.map((_, k) => frameFor(k, N, F)))] : loadOrder(F);
let q = 0;
const one = () => new Promise(res => {
  if (q >= order.length) return res(false);
  const i = order[q++], im = new Image(); im.decoding = 'async'; im.src = url(i);
  const ok = () => { img[i] = im; have[i] = true; stats.loaded++; if (shown < 0 || Math.abs(i - want) < Math.abs(shown - want)) { shown = -1; draw(); } res(true); };
  // decode() can reject under load in Chromium even for valid images; a completed load is still drawable
  im.onload = () => im.decode().then(ok, ok); im.onerror = () => { stats.failed = (stats.failed || 0) + 1; res(true); };
});
(async () => { const w = async () => { while (await one()); }; await Promise.all([w(), w(), w(), w()]); window.ready = true; })();

// live three.js only for the agentic demo, loaded when it nears the viewport
new IntersectionObserver(([e], o) => {
  if (!e.isIntersecting) return; o.disconnect();
  Promise.all([import('three'), import('./model.js'), import('./agent.js')]).then(([THREE, md, ag]) => ag.start(THREE, md.loadModel('so101')));
}, {rootMargin: '100% 0px'}).observe(document.getElementById('ag'));

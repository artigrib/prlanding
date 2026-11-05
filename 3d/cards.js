// /3d/ main path: static flow cards (poster + copy). Only the agentic demo is live three.js; ?live keeps the WebGL flythrough.
const G = await fetch('groups.json').then(r => r.json()).catch(() => []);
document.querySelectorAll('.t').forEach(sec => {
  const g = G[+sec.dataset.i], m = sec.querySelector('.meta');
  if (!g || !m) return;
  m.innerHTML = `<b>${g.models.map(x => x.name).join(' · ')}</b>` +
    (g.count ? `${g.key === 'mix' ? '' : 'Kategorie: '}${g.label} · ${g.count} projektů` : `${g.label} · ${g.models.length} modely`);
});
const bar = document.getElementById('bar');
addEventListener('scroll', () => { if (bar) bar.style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight) * 100) + '%'; }, {passive: true});
new IntersectionObserver(([e], o) => {
  if (!e.isIntersecting) return; o.disconnect();
  Promise.all([import('three'), import('./model.js'), import('./agent.js')]).then(([THREE, md, ag]) => ag.start(THREE, md.loadModel('so101')));
}, {rootMargin: '100% 0px'}).observe(document.getElementById('ag'));
window.ready = true;

// Sound sliders (master / effects / ambience) injected into the pause panel.
// Self-contained: own markup + scoped CSS, persists through sfx.setLevels (store, try/catch).
const CSS = `.snd-set{border:0;margin:0;padding:0;display:grid;gap:8px}
.snd-set legend{font-family:var(--mono,monospace);font-size:12px;color:var(--mute,#5E5E59);padding:0;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.snd-row{display:grid;grid-template-columns:7.5em 1fr 3em;align-items:center;gap:10px;font-size:14px}
.snd-row output{font-family:var(--mono,monospace);font-size:12px;color:var(--ink-2,#3A3A36);text-align:right}
.snd-row input{width:100%;accent-color:var(--accent,#E8461E);min-height:28px;margin:0}
.snd-set[data-muted=true] .snd-row input{opacity:.45}`;   // labels stay readable (contrast) while muted

const ROWS = [['master', 'Hlasitost'], ['sfx', 'Efekty'], ['amb', 'Prostředí']];

export function mountSettings(sfx, host = document.getElementById('pause')) {
  if (!host || host.querySelector('.snd-set')) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const fs = document.createElement('fieldset'); fs.className = 'snd-set';
  fs.innerHTML = '<legend>Zvuk</legend>' + ROWS.map(([k, label]) =>
    `<label class="snd-row"><span>${label}</span><input type="range" min="0" max="100" step="5" data-k="${k}" aria-label="${label}"><output></output></label>`).join('');
  const sync = () => {
    fs.dataset.muted = String(sfx.muted);
    for (const inp of fs.querySelectorAll('input')) {
      const v = Math.round((sfx.levels[inp.dataset.k] ?? 1) * 100);
      inp.value = v; inp.nextElementSibling.textContent = v + ' %';
    }
  };
  fs.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.k; if (!k) return;
    sfx.setLevels({ [k]: Math.max(0, Math.min(1, e.target.value / 100)) });
    e.target.nextElementSibling.textContent = e.target.value + ' %';
  });
  fs.addEventListener('change', () => { sfx.unlock(); sfx.click(); });
  const hint = host.querySelector('.hint');
  host.insertBefore(fs, hint || null);
  sync();
  // keep in step with the M key / toolbar toggle
  new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['hidden'] });
}

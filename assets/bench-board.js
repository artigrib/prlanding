// PR-Bench leaderboard (/bench/, /en/bench/): renders a results JSON (bench/run.mjs, schema prbench-results@1)
// into #prb-table. The source is the table's data-src. Mock data keep the "sample data – mock" note visible.
(function () {
  var table = document.getElementById('prb-table');
  if (!table) return;
  var en = document.documentElement.lang === 'en';
  var T = en
    ? { fail: 'Results could not be loaded.', none: 'No results yet.', run: 'Run', tasks: 'tasks', seeds: 'seeds', set: 'set', mock: 'mock models', vision: 'images' }
    : { fail: 'Výsledky se nepodařilo načíst.', none: 'Zatím žádné výsledky.', run: 'Běh', tasks: 'úloh', seeds: 'opakování', set: 'sada', mock: 'mock modely', vision: 'obraz' };
  var nf = new Intl.NumberFormat(en ? 'en-GB' : 'cs-CZ', { maximumFractionDigits: 1 });
  var usd = new Intl.NumberFormat(en ? 'en-GB' : 'cs-CZ', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  var tbody = table.querySelector('tbody');
  function cell(tag, text, cls) { var c = document.createElement(tag); c.textContent = text; if (cls) c.className = cls; return c; }
  function msg(text) { tbody.textContent = ''; var tr = document.createElement('tr'); var td = cell('td', text); td.colSpan = 6; tr.appendChild(td); tbody.appendChild(tr); }
  fetch(table.getAttribute('data-src'), { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
    var models = (j.models || []).slice().sort(function (a, b) { return b.score - a.score; });
    var note = document.getElementById('prb-mock');
    if (note) note.style.display = j.mock ? '' : 'none';   // .doc-note sets display, so [hidden] alone would not hide it
    if (!models.length) return msg(T.none);
    tbody.textContent = '';
    models.forEach(function (m) {
      var tr = document.createElement('tr');
      var th = document.createElement('th'); th.scope = 'row';
      var code = document.createElement('code'); code.textContent = m.model; th.appendChild(code);
      if (m.vision) th.appendChild(cell('span', ' · ' + T.vision, 'n'));
      tr.appendChild(th);
      tr.appendChild(cell('td', nf.format(m.score)));
      tr.appendChild(cell('td', m.successes + '/' + m.episodes + ' (' + Math.round(m.success_rate * 100) + ' %)'));
      tr.appendChild(cell('td', usd.format(m.cost_usd)));
      tr.appendChild(cell('td', nf.format(m.mean_steps)));
      tr.appendChild(cell('td', String(j.date || '').slice(0, 10), 'n'));
      tbody.appendChild(tr);
    });
    var meta = document.getElementById('prb-meta');
    if (meta) meta.textContent = T.run + ' ' + j.run_id + ' · ' + (j.tasks || []).length + ' ' + T.tasks + ' × ' + j.seeds + ' ' + T.seeds + ' · ' + T.set + ' ' + j.set + (j.mock ? ' · ' + T.mock : '');
  }).catch(function () { msg(T.fail); });
})();

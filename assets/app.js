(function () {
  'use strict';
  var R = window.PR_ROBOTS, C = window.PR_COLORS, CATS = window.PR_CATS, CFG = window.PR_CONFIG || {};
  var byId = {}; R.forEach(function (r, i) { r.idx = i; byId[r.id] = r; });
  var mobile = window.matchMedia('(max-width: 860px)');
  var ROOT = document.body.getAttribute('data-root') || '';
  var SITE = 'https://printedrobotics.cz/';
  function href(id) { return ROOT + 'sada/' + id + '/'; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function no(r) { return (r.idx < 9 ? '0' : '') + (r.idx + 1); }
  function src(r, color) { return r.render ? ROOT + 'img/' + r.id + '_' + (color || 'white') + '.jpg' : (r.photo || ''); }
  function tile(r, color, extra, eager) {
    var s = src(r, color);
    var fb = r.render && color && color !== 'white' ? ' onerror="this.onerror=null;this.src=\'' + ROOT + 'img/' + r.id + '_white.jpg\'"' : '';
    var inner = s ? '<img src="' + s + '" alt="' + esc(r.alt) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' width="1200" height="900"' + fb + '>'
      : '<div class="ph"><b>' + esc(r.name) + '</b><span class="mono-s">Vizualizace se připravuje</span></div>';
    return '<div class="tile">' + (extra || '') + inner + '</div>';
  }
  function $(sel) { return document.querySelector(sel); }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }
  function status(r) { return r.preparing ? 'Připravujeme' : 'Předobjednávka'; }

  /* contact: shown wherever a slot exists, only once an address is configured */
  function contactHtml() { return CFG.CONTACT_EMAIL ? '<a href="mailto:' + esc(CFG.CONTACT_EMAIL) + '">' + esc(CFG.CONTACT_EMAIL) + '</a>' : ''; }
  var fc = $('#footer-contact');
  if (fc && CFG.CONTACT_EMAIL) fc.innerHTML = '· ' + contactHtml();

  /* external links open in a new tab */
  function extLinks(root) {
    (root || document).querySelectorAll('a[href^="http"]').forEach(function (a) {
      if (a.hostname === location.hostname) return;
      a.target = '_blank'; a.rel = 'noopener';
    });
  }

  /* shared sender for every form (pre-order, notify, question, school) */
  function send(payload) {
    if (!CFG.FORM_ENDPOINT) return Promise.reject(new Error('no-endpoint'));
    var gs = /script\.google\.com/.test(CFG.FORM_ENDPOINT);
    payload._gotcha = (document.querySelector('input[name=_gotcha]') || {}).value || '';
    if (document.documentElement.lang === 'en') payload.lang = 'en'; // reply in English
    // Google Apps Script cannot answer a CORS preflight, so it gets a "simple" text/plain request
    return fetch(CFG.FORM_ENDPOINT, { method: 'POST', redirect: 'follow',
      headers: gs ? { 'Content-Type': 'text/plain;charset=utf-8' } : { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload) })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return gs ? res.json() : res; })
      .then(function (j) { if (gs && !(j && j.ok)) throw new Error((j && j.error) || 'rejected'); return j; });
  }
  var NO_ENDPOINT_MSG = 'Formulář spouštíme během několika dní. Zatím jsme nic neodeslali — zkuste to prosím brzy znovu' + (CFG.CONTACT_EMAIL ? ' nebo napište na ' + CFG.CONTACT_EMAIL : '') + '.';
  function validEmailStr(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim()); }

  /* header: hide on scroll down, show on scroll up */
  var hdr = $('#site-h');
  if (hdr) {
    var lastY = window.scrollY, ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY, d = y - lastY;
        if (y < 80 || d < -6) hdr.classList.remove('is-hidden');
        else if (d > 6) hdr.classList.add('is-hidden');
        lastY = y; ticking = false;
      });
    }, { passive: true });
    hdr.addEventListener('focusin', function () { hdr.classList.remove('is-hidden'); });
  }

  /* Czech typography on all visible text: no one-letter preposition at a line end, numbers glued to units, en dash */
  // short words that must not end a line (designer's rule): Czech prepositions/conjunctions + English function words
  var SHORT_RE = new RegExp('(^|[\\s(„“"\'/–-])(' + [
    'a', 'i', 'k', 'o', 's', 'u', 'v', 'z', 've', 'ze', 'ke', 'se', 'na', 'do', 'od', 'po', 'za', 'ku', 'až', 'či', 'ač', 'ani', 'pro', 'při', 'nad', 'pod', 'bez', 'než', 'jak', 'aby', 'ale', 'tak', 'jen', 'už',
    'an', 'and', 'at', 'the', 'of', 'to', 'in', 'on', 'by', 'for', 'or', 'is', 'it', 'as', 'be', 'we', 'my', 'no'
  ].join('|') + ') (?=\\S)', 'gi');
  function typo(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentNode && n.parentNode.nodeName;
      return /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|TITLE)$/.test(p) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    var n;
    while ((n = w.nextNode())) {
      var t = n.nodeValue, u = t
        .replace(SHORT_RE, '$1$2\u00A0').replace(SHORT_RE, '$1$2\u00A0')
        .replace(/(\d) (?=(\d{3})\b)/g, '$1 ')
        .replace(/(\d) (?=(Kč|EUR|USD|€|V|A|h|mm|cm|m|kg|g|Nm|ks|%|dní|let|os)\b)/g, '$1 ')
        .replace(/ [—–] /g, ' – ');
      if (u !== t) n.nodeValue = u;
    }
  }
  var typoQueued = false;
  function typoSoon() { if (typoQueued) return; typoQueued = true; requestAnimationFrame(function () { typoQueued = false; typo(document.body); }); }
  if ('MutationObserver' in window) new MutationObserver(typoSoon).observe(document.body, { childList: true, subtree: true });
  typoSoon();

  /* soft capture: one e-mail field for visitors not ready to pre-order (price alert / news) */
  function softForm(kind, robot) {
    var t = kind === 'price'
      ? ['Zatím nevíte?', 'Pošleme vám jeden e-mail, až budeme znát cenu a termín.', 'Dejte mi vědět']
      : ['Novinky a ceny e-mailem', 'Nové sady a spuštění prodeje. Nejvýš jednou za měsíc, odhlásíte se jedním klikem.', 'Odebírat'];
    return '<form class="soft" novalidate data-soft="' + kind + '"' + (robot ? ' data-robot="' + esc(robot) + '"' : '') + '>' +
      '<b>' + t[0] + '</b><span class="muted">' + t[1] + '</span>' +
      '<span class="soft-row"><label class="sr-only" for="soft-' + kind + '">E-mail</label>' +
      '<input id="soft-' + kind + '" type="email" name="email" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="vas@email.cz">' +
      '<button type="submit" class="btn btn-o">' + t[2] + '</button></span>' +
      '<span class="mono soft-note">Odesláním souhlasíte se zasláním těchto e-mailů. Adresu nikomu nepředáme.</span>' +
      '<span class="soft-msg" role="status" aria-live="polite"></span></form>';
  }
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('form.soft'); if (!f) return;
    e.preventDefault();
    var em = f.querySelector('input[type=email]'), m = f.querySelector('.soft-msg');
    if (!validEmailStr(em.value)) { em.setAttribute('aria-invalid', 'true'); m.textContent = 'Zkontrolujte prosím e-mailovou adresu.'; em.focus(); return; }
    em.removeAttribute('aria-invalid'); m.textContent = 'Odesíláme…';
    var kind = f.getAttribute('data-soft'), robot = f.getAttribute('data-robot') || '';
    // waitlist (home, "Připravujeme"): same sender and sheet, its own type and the chosen interests
    var want = [].map.call(f.querySelectorAll('input[name=want]:checked'), function (x) { return x.value; }).join(',');
    if (kind === 'waitlist' && !want) { m.textContent = 'Vyberte, co chcete připojit.'; f.querySelector('input[name=want]').focus(); return; }
    var subj = kind === 'price' ? 'Cena na e-mail: ' : kind === 'waitlist' ? 'Čekací listina: ' : 'Novinky: ';
    send({ _subject: subj + (kind === 'waitlist' ? want : robot || 'web'), type: kind === 'price' || kind === 'waitlist' ? kind : 'news', robot: kind === 'waitlist' ? want : robot, email: em.value.trim(), page: location.href, source: page === 'quiz' ? 'kviz' : 'web' })
      .then(function () { f.innerHTML = '<b>Hotovo.</b><span class="muted">' + (kind === 'price' ? 'Cenu pošleme na ' + esc(em.value.trim()) + ', jakmile ji budeme znát.' : kind === 'waitlist' ? 'Jste na čekací listině. Napíšeme na ' + esc(em.value.trim()) + ', až půjde připojení vyzkoušet.' : 'Díky, ozveme se, až bude co ukázat.') + '</span>'; })
      .catch(function (er) { m.textContent = er && er.message === 'no-endpoint' ? NO_ENDPOINT_MSG : 'Odeslání se nezdařilo. Zkuste to prosím znovu.'; });
  });
  (function () { var ft = document.querySelector('.site-f'); if (ft && !ft.querySelector('form.soft')) { var d = document.createElement('div'); d.className = 'soft-foot'; d.innerHTML = softForm('news'); ft.insertBefore(d, ft.firstChild); } })();

  var page = document.body.getAttribute('data-page');

  /* ---------- home ---------- */
  if (page === 'home') {
    var FILTERS = [['all', 'Vše'], ['arm', 'Ruce a dlaně'], ['mobile', 'Mobilní'], ['legged', 'Kráčející'], ['desk', 'Stolní'], ['combat', 'Bojoví roboti']];
    ['#robot-count', '#robot-count2'].forEach(function (sel) { var el = $(sel); if (el) el.textContent = R.length; });
    var filter = qs('typ'); if (!FILTERS.some(function (f) { return f[0] === filter; })) filter = 'all';
    function renderFilters() {
      $('#filters').innerHTML = FILTERS.map(function (f) {
        var n = f[0] === 'all' ? R.length : R.filter(function (r) { return r.cat === f[0]; }).length;
        if (!n) return '';
        return '<button type="button" class="filter" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '"><i aria-hidden="true"></i>' + f[1] + '<small>' + n + '</small></button>';
      }).join('');
    }
    function renderCards() {
      var list = R.filter(function (r) { return filter === 'all' || r.cat === filter; });
      $('#count').textContent = list.length + (list.length === 1 ? ' sada' : list.length < 5 ? ' sady' : ' sad');
      $('#cards').innerHTML = list.map(function (r) {
        return '<a class="card" href="' + href(r.id) + '">' + tile(r, 'white', '<span class="tag">' + status(r) + '</span>') +
          '<span class="card-meta"><span class="mono" style="color:var(--ink)">' + no(r) + '</span><span class="mono">' + (r.preparing ? 'Připravujeme' : esc(r.level)) + '</span></span>' +
          '<span><h3>' + esc(r.name) + '</h3><span class="type">' + esc(r.type) + '</span></span>' +
          '<span class="spec1">' + r.card.map(function (s) { return esc(s[1]); }).join(' · ') + '</span>' +
          '<p class="desc">' + esc(r.short) + '</p>' +
          '<dl class="dl2">' + r.card.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('') + '</dl>' +
          '<span class="go">Detail sady <span aria-hidden="true">→</span></span></a>';
      }).join('');
    }
    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]'); if (!b) return;
      filter = b.getAttribute('data-f'); renderFilters(); renderCards();
      try { history.replaceState(null, '', (filter === 'all' ? location.pathname : '?typ=' + filter) + '#katalog'); } catch (e2) {}
      try { sessionStorage.setItem('pr-typ', filter); } catch (e3) {}
    });
    renderFilters(); renderCards();
    $('#lic-body').innerHTML = window.PR_LICENSES.map(function (l) {
      return '<tr><th scope="row">' + l[0] + '</th><td><span class="mk ' + l[1] + '" aria-hidden="true"></span>' + l[2] + '</td><td class="ink2">' + l[3] + '</td></tr>';
    }).join('');
    // active section in nav
    if ('IntersectionObserver' in window) {
      var links = document.querySelectorAll('.nav a[data-sec]');
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a) { if (a.getAttribute('data-sec') === e.target.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      ['top', 'vyzkousejte', 'arena', 'pripravujeme', 'katalog', 'novinky', 'postup', 'komunita', 'licence'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
    }
    // hero preview: a short loop recorded from the real sim (no MuJoCo/three here). Loads only after the page,
    // only when visible, never with reduced motion or Save-Data; the poster image stays underneath.
    var hv = $('.hero-video');
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    var save = navigator.connection && navigator.connection.saveData;
    if (hv && !calm.matches && !save && 'IntersectionObserver' in window) {
      var startVid = function () {
        var vo = new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            if (e.isIntersecting) {
              if (!hv.firstChild) {
                [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(function (t) { var s = document.createElement('source'); s.src = hv.getAttribute('data-' + t[0]); s.type = t[1]; hv.appendChild(s); });
                hv.addEventListener('playing', function () { hv.classList.add('on'); }, { once: true });
                hv.load();
              }
              var pr = hv.play(); if (pr && pr.catch) pr.catch(function () {});
            } else if (hv.firstChild) hv.pause();
          });
        }, { rootMargin: '100px 0px' });
        vo.observe(hv);
        calm.addEventListener && calm.addEventListener('change', function (e) { if (e.matches) { vo.disconnect(); hv.pause(); hv.classList.remove('on'); } });
      };
      if (document.readyState === 'complete') startVid(); else window.addEventListener('load', startVid, { once: true });
    }
  }

  /* ---------- product ---------- */
  if (page === 'product') {
    var r = byId[document.body.getAttribute('data-robot')] || byId.so101;
    var TIERS = [['parts', 'Tištěné díly', 'Hardware si obstaráte sami.'], ['kit', 'Kompletní sada', 'Díly a veškerý hardware dle kusovníku.', 1], ['tested', 'Sada s oživením', 'Elektronika nastavená a otestovaná.']];
    var MATS = r.mats || [['pla', 'PLA+', 'Standard'], ['petg', 'PETG', 'Odolnější teplu']];
    function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
    // configuration lives in the URL so it can be shared and handed over from the quiz
    var st = {
      setup: oneOf(qs('setup'), ['pair', 'single'], 'pair'),
      tier: oneOf(qs('tier'), ['parts', 'kit', 'tested'], 'kit'),
      color: oneOf(qs('color'), C.map(function (c) { return c.id; }), 'white'),
      material: oneOf(qs('material'), MATS.map(function (m) { return m[0]; }), MATS[0][0])
    };
    function syncUrl() {
      var q = [];
      if (r.setups && st.setup !== 'pair') q.push('setup=' + st.setup);
      if (st.tier !== 'kit') q.push('tier=' + st.tier);
      if (st.color !== 'white') q.push('color=' + st.color);
      if (st.material !== MATS[0][0]) q.push('material=' + st.material);
      try { history.replaceState(null, '', location.pathname + (q.length ? '?' + q.join('&') : '') + location.hash); } catch (e) {}
    }
    var fromQuiz = qs('z') === 'kviz';


    function set(sel, txt) { var el = $(sel); if (el) el.textContent = txt; }
    set('#crumb-cat', CATS[r.cat]); set('#crumb-name', r.name);
    set('#p-no', 'N° ' + no(r) + ' — ' + r.type); set('#p-hw', r.hw); set('#p-name', r.name);
    set('#p-author', 'Open-source design: ' + r.author); set('#p-lead', r.lead);
    set('#p-credit', r.credit || (r.render ? 'Vizualizace z CAD projektu' : ''));
    set('#p-cap', 'Obr. 1 — ' + r.name);
    set('#l-name', r.name); set('#l-name2', r.name); set('#l-author', r.author); set('#l-hw', r.hw); set('#l-sw', r.sw); set('#l-hw2', r.hw); set('#l-sw2', r.sw);
    if (window.PR_NO_SW(r)) {
      var lsp = $('#l-sw') && $('#l-sw').parentNode;
      if (lsp) lsp.innerHTML = lsp.innerHTML.replace(/, software pod licencí <span id="l-sw">[^<]*<\/span>/, '. Vlastní software nepotřebuje, ovládá se RC vysílačem');
      set('#l-sw2', 'bez vlastního softwaru (RC vysílač)');
    }
    $('#l-repo').href = r.repo; $('#l-docs').href = r.docs;
    /* safety notes built from what this robot actually contains (shared with tools/build.mjs) */
    $('#safety').innerHTML = window.PR_SAFETY(r).map(esc).join('<br>');
    set('#sb-name', r.name);

    /* back to catalogue: return to the same filter and scroll position */
    var crumb = $('#crumb-back');
    if (crumb) {
      var typ = null; try { typ = sessionStorage.getItem('pr-typ'); } catch (e) {}
      if (typ && typ !== 'all') crumb.href = ROOT + '?typ=' + typ + '#katalog';
      crumb.addEventListener('click', function (e) {
        var ref = document.referrer;
        if (ref && ref.indexOf(location.origin) === 0 && !/\/sada\/|kviz|\/en\/(kit|quiz)\//.test(ref.replace(location.origin, '')) && history.length > 1) { e.preventDefault(); history.back(); }
      });
    }

    /* not yet available: no configurator, just notify + alternative */
    if (r.preparing) {
      $('#p-status span').textContent = 'Připravujeme · ověřujeme licenci s autory';
      $('#top-cta').firstChild.textContent = 'Dejte mi vědět ';
      set('#po-btn-t', 'Dejte mi vědět');
      $('#sbar .btn').textContent = 'Dejte mi vědět';
      document.querySelectorAll('[data-hide-prep]').forEach(function (el) { el.hidden = true; });
      $('#prep-info').hidden = false;
      set('#sec1-label', '01 — Upozornění na dostupnost');
      var alt = byId[r.related[0]] && !byId[r.related[0]].preparing ? byId[r.related[0]] : byId.lekiwi;
      $('#prep-alt').innerHTML = '<a href="' + href(alt.id) + '">' + tile(alt, 'white') + '<span><span class="mono">Mezitím k dispozici</span><b>' + esc(alt.name) + '</b><span class="muted">' + esc(alt.short) + '</span></span></a>';
      $('#po-note').placeholder = 'Na co se těšíte?';
      set('#jump-po', 'Upozornění');
      set('#po-consent-t', 'Souhlasím se zpracováním e-mailu za účelem zaslání upozornění na dostupnost.');
    }
    set('#po-title', r.preparing ? 'Upozornění na dostupnost' : 'Nezávazná předobjednávka');
    /* browser demo (sim/arena): prerendered by tools/build.mjs; the chosen colour follows the visitor where the sim reads ?color= */
    var SIM = r.sim && (window.PR_SIMS || {})[r.sim], simA = $('#sim-cta'), colorChosen = !!qs('color');
    function simHref() {
      var q = [];
      if (SIM.robotParam) q.push('robot=' + r.id);
      if (SIM.colorParam && !r.preparing && colorChosen) q.push('color=' + st.color);
      return ROOT + SIM.path + (q.length ? '?' + q.join('&') : '');
    }
    if (SIM && !simA) {
      simA = document.createElement('a'); simA.className = 'sim-cta'; simA.id = 'sim-cta';
      simA.innerHTML = '<span><b>' + esc(SIM.label) + '</b><small>' + esc(SIM.note) + '</small></span><span aria-hidden="true">→</span>';
      $('#top-cta').parentNode.appendChild(simA);
    }
    if (SIM) simA.href = simHref();
    if (!r.preparing) { var tc = $('#top-cta'); var sd = document.createElement('div'); sd.innerHTML = softForm('price', r.name); tc.parentNode.appendChild(sd.firstChild); }
    $('#po-prep').hidden = true;

    var mode3d = false, viewer = null;
    function renderImg() { var t = $('#p-tile'); t.outerHTML = tile(r, st.color, '', true).replace('class="tile"', 'class="tile" id="p-tile"' + (mode3d ? ' hidden' : '')); }
    function btns(list, key, cls, fmt) {
      return list.map(function (o) { return '<button type="button" class="' + cls + '" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (st[key] === o[0]) + '">' + fmt(o) + '</button>'; }).join('');
    }
    function colorObj() { return C.filter(function (c) { return c.id === st.color; })[0]; }
    function tierName() { return TIERS.filter(function (t) { return t[0] === st.tier; })[0][1]; }
    function summary() { return (r.setups ? (st.setup === 'pair' ? 'Pár · ' : 'Follower · ') : '') + tierName() + ' · ' + colorObj().name + ' · ' + MATS.filter(function (m) { return m[0] === st.material; })[0][1]; }
    function renderBuy() {
      var pair = r.setups && st.setup === 'pair';
      $('#setups-wrap').hidden = !r.setups || r.preparing;
      $('#setups').innerHTML = btns([['pair', 'Pár', 'Leader + follower'], ['single', 'Follower', 'Jedna ruka']], 'setup', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      $('#tiers').innerHTML = btns(TIERS, 'tier', 'tier', function (o) { return '<i aria-hidden="true"></i><span><b>' + o[1] + '</b>' + (o[3] ? '<span class="badge">Doporučujeme</span>' : '') + '<small>' + o[2] + '</small></span>'; });
      $('#colors').innerHTML = C.map(function (c) { return '<button type="button" class="sw" data-k="color" data-v="' + c.id + '" aria-pressed="' + (st.color === c.id) + '" aria-label="' + c.name + '"><i style="background:' + c.hex + '" aria-hidden="true"></i></button>'; }).join('');
      set('#color-name', colorObj().name);
      $('#mats').innerHTML = btns(MATS, 'material', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      var sum = r.preparing ? r.type + ' · ' + r.level : summary();
      set('#summary', sum); set('#sb-sum', sum);
      var items = window.PR_BOX(r, st.tier, pair);
      set('#box-title', tierName() + ' · ' + items.length + ' položek');
      $('#box').innerHTML = items.map(function (it, i) { return '<li><span class="n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span>' + esc(it[0]) + '</span><span class="q">' + esc(it[1]) + '</span><span class="t">' + it[2] + '</span></li>'; }).join('');
      set('#box-note', window.PR_BOX_NOTE(r));
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      st[b.getAttribute('data-k')] = b.getAttribute('data-v');
      renderBuy(); syncUrl();
      if (b.getAttribute('data-k') === 'color') { colorChosen = true; renderImg(); if (viewer) viewer.setColor(colorObj().hex); if (SIM) simA.href = simHref(); }
    });
    renderImg(); renderBuy();
    if (fromQuiz) {
      var qn = $('#quiz-note'); qn.hidden = false;
      syncUrl();
    }

    var specs = window.PR_SPECS(r);
    set('#specs-title', 'Parametry · ' + specs.length);
    $('#specs').innerHTML = specs.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    var FAQ = window.PR_FAQ(r);
    $('#faq-list').innerHTML = FAQ.map(function (f) { return '<details><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('');
    function relHtml(ids) {
      return ids.map(function (id) { var x = byId[id];
        return '<a href="' + href(x.id) + '">' + tile(x, 'white') + '<span class="card-meta mono"><span>' + no(x) + '</span><span>' + status(x) + '</span></span><b>' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + esc(x.short) + '</span></a>'; }).join('');
    }
    $('#related').innerHTML = relHtml(r.related);

    /* videos and articles about the project (click-to-load YouTube, nothing third-party loads before a click) */
    var MEDIA = (window.PR_MEDIA || {})[r.id] || [];
    if (MEDIA.length) {
      var vids = MEDIA.filter(function (m) { return m.type === 'video' && /^[\w-]{11}$/.test(m.yt || ''); });
      var reads = MEDIA.filter(function (m) { return m.type !== 'video'; });
      var TYPE = { article: 'Článek', paper: 'Studie', docs: 'Dokumentace', community: 'Komunita' };
      function when(m) { return [m.source, m.date].filter(Boolean).map(esc).join(' · '); }
      $('#vids').innerHTML = vids.map(function (m, i) {
        return '<figure class="vid"><button type="button" class="vid-play" data-yt="' + m.yt + '" aria-label="YouTube · ' + esc(m.source) + ': přehrát video ' + esc(m.title) + '">' +
          tile(r, C[i % C.length].id, '<span class="tag">YouTube · ' + esc(m.source) + '</span>').replace('class="tile"', 'class="tile vid-tile"') + '<span class="vid-ico" aria-hidden="true">▶</span></button>' +
          '<figcaption><b>' + esc(m.title) + '</b><span class="mono">' + when(m) + '</span>' + (m.note ? '<span class="ink2">' + esc(m.note) + '</span>' : '') +
          '<a href="' + esc(m.url) + '" class="mono">Otevřít na YouTube ↗</a></figcaption></figure>';
      }).join('');
      $('#reads').innerHTML = reads.map(function (m) {
        return '<li><a href="' + esc(m.url) + '"><span class="mono">' + (TYPE[m.type] || 'Odkaz') + '</span><span><b>' + esc(m.title) + ' ↗</b><span class="mono">' + when(m) + '</span>' + (m.note ? '<span class="ink2">' + esc(m.note) + '</span>' : '') + '</span></a></li>';
      }).join('');
      $('#vids').hidden = !vids.length; $('#reads').hidden = !reads.length;
      $('#media').hidden = false; $('#jump-media').hidden = false;
      $('#vids').addEventListener('click', function (e) {
        var b = e.target.closest('[data-yt]'); if (!b) return;
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-yt') + '?autoplay=1&rel=0';
        f.title = b.getAttribute('aria-label').replace(/^.*?přehrát video /, '');
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.className = 'vid-frame';
        b.replaceWith(f);
      });
    }

    /* 3D viewer (lazy) */
    if (r.glb) {
      var tabs = $('#viewtabs'), host = $('#v3d'), bar = $('#v3d-bar'), msg3 = $('#v3d-msg'), range = $('#v3d-range'), tog = $('#v3d-toggle'), play = $('#v3d-play');
      tabs.hidden = false;
      function syncBar() { var e = viewer ? viewer.explode : 0; range.value = Math.round(e * 100); tog.firstChild.textContent = e > 0.5 ? 'Složit ' : 'Rozložit '; }
      function setMode(m) {
        mode3d = m === '3d';
        tabs.querySelectorAll('.vtab').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === m)); });
        $('#p-tile').hidden = mode3d; host.hidden = !mode3d; bar.hidden = !mode3d;
        if (mode3d && !viewer) {
          import('./viewer3d.js').then(function (mod) {
            viewer = mod.mountViewer(host, ROOT + 'models/' + r.id + '.glb', {
              color: colorObj().hex,
              label: '3D model: ' + r.name,
              onReady: function (n) { msg3.remove(); $('#v3d-hint').textContent = n + ' dílů · táhněte pro otočení · dva prsty nebo kolečko pro přiblížení'; },
              onError: function () { msg3.textContent = '3D model se nepodařilo načíst.'; }
            });
          }).catch(function () { msg3.textContent = 'Váš prohlížeč 3D náhled nepodporuje.'; });
        }
      }
      tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) setMode(b.getAttribute('data-view')); });
      range.addEventListener('input', function () { if (viewer) { viewer.setExplode(range.value / 100); tog.firstChild.textContent = range.value > 50 ? 'Složit ' : 'Rozložit '; } });
      tog.addEventListener('click', function () { if (!viewer) return; var to = viewer.explode > 0.5 ? 0 : 1; viewer.animateTo(to, syncBar); tog.firstChild.textContent = to ? 'Složit ' : 'Rozložit '; });
      play.addEventListener('click', function () { if (viewer) viewer.assemble(syncBar); });
    }

    /* collapsible sections: open on desktop; on mobile only the flagged one */
    var accs = document.querySelectorAll('details.acc');
    function syncAcc() { accs.forEach(function (d) { d.open = !mobile.matches || d.hasAttribute('data-mobile-open'); }); }
    syncAcc(); mobile.addEventListener ? mobile.addEventListener('change', syncAcc) : mobile.addListener(syncAcc);
    accs.forEach(function (d) { d.querySelector('summary').addEventListener('click', function (e) { if (!mobile.matches) e.preventDefault(); }); });
    // in-page links (jump row, header "Licence") open their collapsed section
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function () { var t = document.querySelector(a.getAttribute('href')); var d = t && t.querySelector('details.acc'); if (d) d.open = true; });
    });

    /* sticky pre-order bar: visible when neither the top CTA nor the form is on screen */
    var sbar = $('#sbar');
    if ('IntersectionObserver' in window && sbar) {
      var vis = { top: true, form: false };
      var ob = new IntersectionObserver(function (es) {
        es.forEach(function (e) { vis[e.target.id === 'top-cta' ? 'top' : 'form'] = e.isIntersecting; });
        var on = !vis.top && !vis.form;
        sbar.classList.toggle('on', on); sbar.setAttribute('aria-hidden', on ? 'false' : 'true');
        sbar.querySelector('.btn').tabIndex = on ? 0 : -1;
      });
      ob.observe($('#top-cta')); ob.observe($('#predobjednavka'));
    }

    /* forms */
    function wireEmail(email, err) {
      function showErr(on) { err.hidden = !on; email.setAttribute('aria-invalid', on ? 'true' : 'false'); }
      email.addEventListener('blur', function () { if (email.value) showErr(!validEmailStr(email.value)); });
      email.addEventListener('input', function () { if (!err.hidden && validEmailStr(email.value)) showErr(false); });
      return showErr;
    }
    var form = $('#preorder'), msg = $('#form-msg'), btn = $('#po-btn'), email = $('#po-email'), consent = $('#po-consent');
    var showErr = wireEmail(email, $('#po-email-err'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validEmailStr(email.value)) { showErr(true); email.focus(); return; }
      if (!consent.checked) { $('#po-consent-err').hidden = false; consent.setAttribute('aria-invalid', 'true'); consent.focus(); return; }
      $('#po-consent-err').hidden = true; consent.removeAttribute('aria-invalid');
      var qty = parseInt(form.qty.value, 10) || 1;
      var payload = { _subject: (r.preparing ? 'Upozornění: ' : 'Předobjednávka: ') + r.name + (qty > 1 ? ' ×' + qty : ''), email: email.value.trim(), note: form.note.value, robot: r.name,
        configuration: r.preparing ? '' : summary(), setup: r.setups ? st.setup : '', tier: st.tier, color: st.color, material: st.material, qty: qty,
        school: form.school.checked ? 'ano' : '', ico: form.ico.value.trim(), type: r.preparing ? 'notify' : 'preorder', source: fromQuiz ? 'kviz' : 'web', page: location.href };
      btn.disabled = true; msg.hidden = false; msg.textContent = 'Odesíláme…';
      send(payload).then(function () { done(payload); })
        .catch(function (er) { msg.textContent = er && er.message === 'no-endpoint' ? NO_ENDPOINT_MSG : 'Odeslání se nezdařilo. Zkuste to prosím znovu.'; btn.disabled = false; });
    });
    var school = $('#po-school');
    school.addEventListener('change', function () { $('#po-school-f').hidden = !school.checked; if (school.checked) form.qty.focus(); });

    /* success: what happens next + one more thing to do */
    function done(p) {
      var steps = r.preparing
        ? [['Teď', 'Jste na seznamu. Nic dalšího dělat nemusíte.'], ['Až sadu spustíme', 'Pošleme jeden e-mail na ' + p.email + ' s cenou a termínem.'], ['Kdykoli', 'Odhlásíte se odpovědí na kterýkoli náš e-mail.']]
        : [['Do 2 pracovních dnů', 'Pošleme na ' + p.email + ' cenu a termín expedice pro ' + p.configuration + (p.qty > 1 ? ', ' + p.qty + ' ks' : '') + '.'], ['Po vašem potvrzení', p.school ? 'Vystavíme fakturu na školu nebo firmu' + (p.ico ? ' (IČO ' + p.ico + ')' : '') + ' se splatností. Do té doby nic neplatíte a můžete zrušit.' : 'Pošleme platební odkaz. Do té doby nic neplatíte a můžete zrušit.'], ['Tisk a kompletace', 'Díly vytiskneme, sadu zkompletujeme a pošleme s číslem zásilky.']];
      var shareUrl = SITE + 'sada/' + r.id + '/';
      $('#po-wrap').innerHTML = '<div class="form-ok" role="status" tabindex="-1" id="po-ok"><span class="mono">Hotovo</span><b>Děkujeme, máme to.</b>' +
        '<ol class="next">' + steps.map(function (s) { return '<li><span class="mono">' + esc(s[0]) + '</span><span>' + esc(s[1]) + '</span></li>'; }).join('') + '</ol>' +
        (CFG.CONTACT_EMAIL ? '<span class="ink2" style="font-size:15px">Dotaz? ' + contactHtml() + '</span>' : '') +
        '<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="btn btn-o" id="share">Poslat odkaz kamarádovi</button><a class="btn btn-o" href="#dalsi">Co k tomu přikoupit ↓</a></div>' +
        '<span class="mono" id="share-msg" role="status" aria-live="polite"></span></div>';
      $('#po-ok').focus();
      $('#share').addEventListener('click', function () {
        var m = $('#share-msg');
        if (navigator.share) { navigator.share({ title: 'Stavebnice pro ' + r.name, url: shareUrl }).catch(function () {}); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(shareUrl) : Promise.reject()).then(function () { m.textContent = 'Odkaz zkopírován.'; }, function () { m.textContent = shareUrl; });
      });
      $('#sbar').remove();
    }

    /* question form under FAQ */
    var qf = $('#ask');
    if (qf) {
      if (CFG.CONTACT_EMAIL) { $('#ask-contact').innerHTML = 'Nebo napište přímo na ' + contactHtml() + '.'; }
      var qErr = wireEmail($('#ask-email'), $('#ask-email-err')), qMsg = $('#ask-msg');
      qf.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!$('#ask-text').value.trim()) { qMsg.hidden = false; qMsg.textContent = 'Napište prosím, na co se chcete zeptat.'; $('#ask-text').focus(); return; }
        if (!validEmailStr($('#ask-email').value)) { qErr(true); $('#ask-email').focus(); return; }
        qMsg.hidden = false; qMsg.textContent = 'Odesíláme…';
        send({ _subject: 'Dotaz: ' + r.name, type: 'question', robot: r.name, email: $('#ask-email').value.trim(), question: $('#ask-text').value, page: location.href })
          .then(function () { qf.innerHTML = '<div class="form-ok" role="status"><span class="mono">Odesláno</span><b>Odpovíme do 24 hodin.</b><span class="ink2">V pracovní dny obvykle dřív.</span></div>'; })
          .catch(function (er) { qMsg.textContent = er && er.message === 'no-endpoint' ? NO_ENDPOINT_MSG : 'Odeslání se nezdařilo. Zkuste to prosím znovu.'; });
      });
    }
    extLinks();
  }

  /* ---------- not found (unknown robot or page) ---------- */
  if (page === 'notfound') {
    var slug = (qs('r') || (/\/(?:sada|en\/kit)\/([^\/?#]+)/.exec(location.pathname) || [])[1] || '').toLowerCase();
    // legacy links sada.html?r=<id> → /sada/<id>/ with the rest of the query kept
    if (slug && byId[slug]) {
      var rest = location.search.replace(/[?&]r=[^&]*/, '').replace(/^&/, '?');
      location.replace(href(slug) + rest + location.hash); return;
    }
    var key = slug.replace(/[^a-z0-9]/g, '');
    var guess = key ? R.filter(function (x) { var n = (x.id + x.name).toLowerCase().replace(/[^a-z0-9]/g, ''); return !x.preparing && (n.indexOf(key.slice(0, 3)) >= 0); }) : [];
    ['so101', 'otto', 'exomy', 'spot'].forEach(function (id) { if (guess.indexOf(byId[id]) < 0) guess.push(byId[id]); });
    $('#nf-title').innerHTML = slug ? 'Sadu „' + esc(slug) + '“<br>jsme nenašli.' : 'Tenhle díl<br>jsme nevytiskli.';
    $('#nf-lead').textContent = slug ? 'Odkaz je možná starý nebo obsahuje překlep. Podívejte se na podobné sady, nebo si nechte poradit.' : 'Stránka neexistuje nebo byla přesunuta.';
    $('#nf-cards').innerHTML = guess.slice(0, 3).map(function (x) {
      return '<a href="' + href(x.id) + '">' + tile(x, 'white') + '<span><b style="font-size:21px;font-weight:500;letter-spacing:-.03em;display:block">' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + esc(x.level) + ' · ' + esc(x.type) + '</span></span></a>';
    }).join('');
    document.querySelectorAll('[data-root-href]').forEach(function (a) { a.href = ROOT + a.getAttribute('data-root-href'); });
  }

  /* ---------- quiz ---------- */
  if (page === 'quiz') {
    var Q = [
      ['Stavěli jste už něco podobného?', 'Podle zkušenosti zvolíme náročnost.', [['none', 'Ještě nikdy', 'Šroubovák zvládnu, pájku ne'], ['some', 'Něco málo', '3D tisk, Arduino, Raspberry Pi'], ['pro', 'Ano, pravidelně', 'ROS, Python, elektronika']]],
      ['Co od robota čekáte?', 'Cíl rozhoduje víc než cena.', [['ai', 'Učit se AI a robotiku', 'Trénovat modely, LeRobot'], ['school', 'Do školy nebo kroužku', 'Výuka pod vedením dospělého, 14+'], ['walk', 'Chci, aby chodil', 'Nohy místo kol'], ['rover', 'Rover jako na Marsu', 'Šest kol, terén venku'], ['lab', 'Výzkum, laboratoř', 'Přesnost, ROS 2'], ['fight', 'Souboje robotů', 'Bojový robot do 150 g, zápasy v aréně']]],
      ['Jak velký projekt chcete?', 'Orientačně podle rozsahu a ceny dílů.', [['small', 'Malý', 'Víkend, nižší rozpočet'], ['mid', 'Střední', 'Několik večerů'], ['big', 'Velký', 'Vlajková loď, vyšší rozpočet']]]
    ];
    var REASONS = {
      so101: ['Nejrozšířenější open-source ruka pro AI', 'Vhodná pro začátečníky', 'Velká komunita a návod krok za krokem'],
      lekiwi: ['Ruka SO-101 na pojízdné základně', 'Ideální pro sběr dat a teleoperaci', 'Později rozšiřitelné na XLeRobot'],
      duck: ['Chodí díky naučené RL politice', 'Výrazný design, skvělý na ukázky', 'Pro zkušené: kalibrace a ladění'],
      otto: ['Nejjednodušší vstup do robotiky', 'Arduino a programování bloky', 'Pro školy a kroužky — 14+, mladší s dospělým'],
      spot: ['Robotický pes se 12 klouby', 'Raspberry Pi a velká komunita', 'Střední náročnost'],
      thor: ['Průmyslová kinematika na krokových motorech', 'ROS 2 a MoveIt 2', 'Nosnost až 750 g'],
      hand: ['8 stupňů volnosti ve dlani', 'Doplněk k ruce SO-101', 'Pro výzkum úchopu'],
      exomy: ['Rover podle ExoMars od ESA', 'Webové ovládání z mobilu, ROS uvnitř', 'Šest kol, každé řízené'],
      sawppy: ['Zmenšenina roveru Curiosity', 'Podvozek rocker-bogie zvládne terén', 'Velký projekt na léto'],
      xle: ['Dvě ruce a mobilní základna', 'Ovládání přes VR či gamepad', 'Připravujeme'],
      so102: ['Tužší a rychlejší nástupce SO-101, stále kompatibilní s LeRobot', 'Paralelní chapadlo s kamerou a nosnost 300 g', 'Otevřený hardware i pro komerční použití'],
      aira: ['Silné motory Damiao jako u výzkumných rukou', 'Plugin pro LeRobot: ACT, Diffusion Policy i PI0 hned', 'Šest os a chapadlo z karbonového PLA a TPU'],
      parol6: ['Nejbližší průmyslovému robotu, co si vytisknete doma', 'Opakovatelnost 0,08 mm díky planetovým převodovkám', 'Vlastní GUI se simulátorem, Python API i ROS 2'],
      bhl: ['Open-source humanoid v dětské velikosti', 'I převodovky pohonů se tisknou z PLA', 'Chodí díky RL politice přenesené ze simulace'],
      osr: ['Robustní rover z hliníku podle marsovských vozítek', 'Open-source hardware s certifikací OSHWA', 'Rocker-bogie a natáčení všech rohových kol'],
      svrn: ['Modulární robot pro první soutěže do 150 g', 'Pohon 4×4 a moduly flipper nebo chapadlo', 'Bez rotující zbraně – bezpečný pro první zápasy'],
      vert150: ['Klasický vertikální spinner v kategorii 150 g', 'Běžné díly: BE1806, Malenki Nano, motory N20', 'Jen pro uzavřenou arénu; vyžaduje zkušenost s LiPo a RC'],
      stackchan: ['Nejroztomilejší open-source robot na stůl', 'Programování v JavaScriptu i blocích v prohlížeči', 'Jen dvě serva a pár šroubků — ideální první stavba']
    };
    // first pick per goal × experience × size; every available kit wins at least once
    var MATRIX = {
      ai:     { none: 'so101', some: { small: 'so101', mid: 'lekiwi', big: 'lekiwi' }, pro: { small: 'so102', mid: 'lekiwi', big: 'aira' } },
      school: { none: { small: 'stackchan', mid: 'otto', big: 'otto' }, some: { small: 'otto', mid: 'so101', big: 'so101' }, pro: { small: 'so101', mid: 'spot', big: 'spot' } },
      walk:   { none: { small: 'otto', mid: 'otto', big: 'spot' }, some: { small: 'spot', mid: 'spot', big: 'duck' }, pro: { small: 'duck', mid: 'duck', big: 'bhl' } },
      rover:  { none: 'exomy', some: { small: 'exomy', mid: 'exomy', big: 'sawppy' }, pro: { small: 'sawppy', mid: 'sawppy', big: 'osr' } },
      lab:    { none: 'so101', some: { small: 'hand', mid: 'so101', big: 'so102' }, pro: { small: 'hand', mid: 'thor', big: 'parol6' } },
      // the only combat kit on sale; the spinner (vert150, preparing) follows as an alternative
      fight:  { none: 'svrn', some: 'svrn', pro: 'svrn' }
    };
    var FAMILY = { ai: ['so101', 'lekiwi', 'so102', 'aira', 'xle', 'hand'], school: ['stackchan', 'otto', 'so101', 'spot'], walk: ['otto', 'spot', 'duck', 'bhl'], rover: ['exomy', 'sawppy', 'osr', 'lekiwi'], lab: ['so101', 'so102', 'hand', 'thor', 'parol6'], fight: ['svrn', 'vert150', 'otto'] };
    function pick(a) {
      var exp = a[0], goal = a[1], size = a[2], m = MATRIX[goal][exp];
      var first = typeof m === 'string' ? m : m[size];
      return [first].concat(FAMILY[goal].filter(function (id) { return id !== first; })).slice(0, 3);
    }
    window.PR_QUIZ_PICK = pick; // exposed for automated checks
    // configuration handed to the product page
    function cfg(b, a) {
      var q = ['z=kviz'];
      if (b.preparing) return '?' + q.join('&');
      if (a[0] === 'none' && (b._cs || b).level !== 'Začátečník') q.push('tier=tested');
      return '?' + q.join('&');
    }
    var step = 0, ans = [], editing = false;
    function label(i, id) { return Q[i][2].filter(function (o) { return o[0] === id; })[0][1]; }
    function render() {
      var root = $('#quiz');
      if (step < Q.length) {
        var q = Q[step];
        root.innerHTML = '<div class="g" style="padding-top:24px;row-gap:12px"><div class="a1 mono">Otázka ' + (step + 1) + ' ze 3</div><div class="a4 progress" aria-hidden="true">' + [0, 1, 2].map(function (i) { return '<i class="' + (i <= step ? 'on' : '') + '"></i>'; }).join('') + '</div></div>' +
          '<div class="g" style="margin-top:clamp(24px,6vw,96px);row-gap:24px"><div class="a1 big-num hide-s" aria-hidden="true">0' + (step + 1) + '</div><div class="a4" style="display:flex;flex-direction:column;gap:28px">' +
          '<div><h1 class="h2" style="font-size:clamp(28px,4.4vw,64px)" tabindex="-1" id="q-h">' + q[0] + '</h1><p class="lead muted" style="margin-top:8px">' + q[1] + '</p></div>' +
          '<div class="q-opts" role="group" aria-labelledby="q-h">' + q[2].map(function (o, i) { return '<button type="button" class="q-opt" data-a="' + o[0] + '" aria-pressed="' + (ans[step] === o[0]) + '"><span class="mono">' + 'ABCDEF'[i] + '</span><b>' + o[1] + '</b><span>' + o[2] + '</span></button>'; }).join('') + '</div>' +
          (step || editing ? '<div style="border-top:1px solid var(--line);padding-top:12px"><button type="button" id="back" class="linkbtn">' + (editing ? '← Zpět na výsledek' : '← Zpět') + '</button></div>' : '') + '</div></div>';
        if (step || editing) $('#q-h').focus();
      } else {
        var res = pick(ans), b = byId[res[0]], c = cfg(b, ans);
        root.innerHTML = '<div class="g" style="padding-top:24px;row-gap:8px"><div class="a1 mono">Výsledek · upravit odpověď</div><div class="a4 chips">' + ans.map(function (id, i) { return '<button type="button" class="chip" data-edit="' + i + '"><span class="mono">' + (i + 1) + '</span>' + label(i, id) + ' <span aria-hidden="true">✎</span><span class="sr-only"> — změnit</span></button>'; }).join('') + '</div></div>' +
          '<div class="g" style="margin-top:clamp(24px,5vw,72px);row-gap:24px"><div class="a1 hide-s" style="display:flex;flex-direction:column;gap:12px"><span class="mono">Doporučujeme</span></div>' +
          '<div class="a4" style="display:flex;flex-direction:column;gap:56px"><div class="res">' + tile(b, 'white', '', true) +
          '<div style="display:flex;flex-direction:column;gap:14px"><div class="card-meta mono"><span>' + b.level + '</span><span>' + status(b) + '</span></div><span class="muted" style="font-size:17px">Doporučujeme stavebnici pro</span><h1 class="p-name" style="margin-top:-6px" tabindex="-1" id="q-h">' + esc(b.name) + '</h1>' +
          '<ul class="reasons">' + REASONS[b.id].map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + (/tier=tested/.test(c) ? '<li><span>Doporučujeme Sadu s oživením — elektroniku nastavíme za vás</span></li>' : '') + '</ul>' +
          '<a class="btn btn-act" href="' + href(b.id) + c + '#predobjednavka">' + (b.preparing ? 'Dejte mi vědět' : 'Předobjednat') + ' <span aria-hidden="true">→</span></a>' +
          '<a class="btn btn-o" href="' + href(b.id) + c + '">Detail sady <span aria-hidden="true">→</span></a></div></div>' +
          '<div><div class="mono" style="border-top:1px solid var(--ink);padding-top:12px;margin-bottom:16px">Také by vás mohlo bavit</div><div class="alts">' +
          res.slice(1).map(function (id) { var x = byId[id]; return '<a href="' + href(x.id) + cfg(x, ans) + '">' + tile(x, 'white') + '<span><b style="font-size:21px;font-weight:500;letter-spacing:-.03em;display:block">' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + (x.preparing ? 'Připravujeme' : x.level) + ' · ' + esc(x.type) + '</span></span></a>'; }).join('') +
          '</div></div>' + (b.preparing ? '' : softForm('price', b.name)) + '<button type="button" id="restart" class="linkbtn" style="align-self:flex-start">Začít kvíz znovu</button></div></div>';
        $('#q-h').focus();
      }
    }
    $('#quiz').addEventListener('click', function (e) {
      var o = e.target.closest('[data-a]');
      if (o) { ans[step] = o.getAttribute('data-a'); step = editing ? Q.length : step + 1; editing = false; render(); window.scrollTo(0, 0); return; }
      var ed = e.target.closest('[data-edit]');
      if (ed) { editing = true; step = +ed.getAttribute('data-edit'); render(); window.scrollTo(0, 0); return; }
      if (e.target.closest('#back')) { if (editing) { editing = false; step = Q.length; } else if (step > 0) step--; render(); return; }
      if (e.target.closest('#restart')) { step = 0; ans = []; editing = false; render(); window.scrollTo(0, 0); }
    });
    render();
  }
})();

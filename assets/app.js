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
    return fetch(CFG.FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res; });
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

  var page = document.body.getAttribute('data-page');

  /* ---------- home ---------- */
  if (page === 'home') {
    var FILTERS = [['all', 'Vše'], ['arm', 'Ruce a dlaně'], ['mobile', 'Mobilní'], ['legged', 'Kráčející']];
    var filter = qs('typ'); if (!FILTERS.some(function (f) { return f[0] === filter; })) filter = 'all';
    function renderFilters() {
      $('#filters').innerHTML = FILTERS.map(function (f) {
        var n = f[0] === 'all' ? R.length : R.filter(function (r) { return r.cat === f[0]; }).length;
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
      ['postup', 'katalog', 'licence'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
    }
  }

  /* ---------- product ---------- */
  if (page === 'product') {
    var r = byId[document.body.getAttribute('data-robot')] || byId.so101;
    var TIERS = [['parts', 'Tištěné díly', 'Hardware si obstaráte sami.'], ['kit', 'Kompletní sada', 'Díly a veškerý hardware dle kusovníku.', 1], ['tested', 'Sada s oživením', 'Elektronika nastavená a otestovaná.']];
    var MATS = [['pla', 'PLA+', 'Standard'], ['petg', 'PETG', 'Odolnější teplu']];
    function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
    // configuration lives in the URL so it can be shared and handed over from the quiz
    var st = {
      setup: oneOf(qs('setup'), ['pair', 'single'], 'pair'),
      tier: oneOf(qs('tier'), ['parts', 'kit', 'tested'], 'kit'),
      color: oneOf(qs('color'), C.map(function (c) { return c.id; }), 'white'),
      material: oneOf(qs('material'), ['pla', 'petg'], 'pla')
    };
    function syncUrl() {
      var q = [];
      if (r.setups && st.setup !== 'pair') q.push('setup=' + st.setup);
      if (st.tier !== 'kit') q.push('tier=' + st.tier);
      if (st.color !== 'white') q.push('color=' + st.color);
      if (st.material !== 'pla') q.push('material=' + st.material);
      try { history.replaceState(null, '', location.pathname + (q.length ? '?' + q.join('&') : '') + location.hash); } catch (e) {}
    }
    var fromQuiz = qs('z') === 'kviz';

    document.title = 'Stavebnice pro ' + r.name + ' — printedrobotics.cz';

    function set(sel, txt) { var el = $(sel); if (el) el.textContent = txt; }
    set('#crumb-cat', CATS[r.cat]); set('#crumb-name', r.name);
    set('#p-no', 'N° ' + no(r) + ' — ' + r.type); set('#p-hw', r.hw); set('#p-name', r.name);
    set('#p-author', 'Open-source design: ' + r.author); set('#p-lead', r.lead);
    set('#p-credit', r.render ? 'Vizualizace z CAD projektu' : (r.credit || ''));
    set('#p-cap', 'Obr. 1 — ' + r.name);
    set('#l-name', r.name); set('#l-name2', r.name); set('#l-author', r.author); set('#l-hw', r.hw); set('#l-sw', r.sw); set('#l-hw2', r.hw); set('#l-sw2', r.sw);
    $('#l-repo').href = r.repo; $('#l-docs').href = r.docs;
    set('#sb-name', r.name);

    /* back to catalogue: return to the same filter and scroll position */
    var crumb = $('#crumb-back');
    if (crumb) {
      var typ = null; try { typ = sessionStorage.getItem('pr-typ'); } catch (e) {}
      if (typ && typ !== 'all') crumb.href = ROOT + '?typ=' + typ + '#katalog';
      crumb.addEventListener('click', function (e) {
        var ref = document.referrer;
        if (ref && ref.indexOf(location.origin) === 0 && !/\/sada\/|kviz/.test(ref.replace(location.origin, '')) && history.length > 1) { e.preventDefault(); history.back(); }
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
    $('#po-prep').hidden = true;

    var mode3d = false, viewer = null;
    function renderImg() { var t = $('#p-tile'); t.outerHTML = tile(r, st.color, '', true).replace('class="tile"', 'class="tile" id="p-tile"' + (mode3d ? ' hidden' : '')); }
    function btns(list, key, cls, fmt) {
      return list.map(function (o) { return '<button type="button" class="' + cls + '" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (st[key] === o[0]) + '">' + fmt(o) + '</button>'; }).join('');
    }
    function colorObj() { return C.filter(function (c) { return c.id === st.color; })[0]; }
    function tierName() { return TIERS.filter(function (t) { return t[0] === st.tier; })[0][1]; }
    function summary() { return (r.setups ? (st.setup === 'pair' ? 'Pár · ' : 'Follower · ') : '') + tierName() + ' · ' + colorObj().name + ' · ' + (st.material === 'pla' ? 'PLA+' : 'PETG'); }
    function renderBuy() {
      var pair = r.setups && st.setup === 'pair';
      $('#setups-wrap').hidden = !r.setups || r.preparing;
      $('#setups').innerHTML = btns([['pair', 'Pár', 'Leader + follower'], ['single', 'Follower', 'Jedna ruka']], 'setup', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      $('#tiers').innerHTML = btns(TIERS, 'tier', 'tier', function (o) { return '<i aria-hidden="true"></i><span><b>' + o[1] + '</b>' + (o[3] ? '<span class="badge">Nejčastější volba</span>' : '') + '<small>' + o[2] + '</small></span>'; });
      $('#colors').innerHTML = C.map(function (c) { return '<button type="button" class="sw" data-k="color" data-v="' + c.id + '" aria-pressed="' + (st.color === c.id) + '" aria-label="' + c.name + '"><i style="background:' + c.hex + '" aria-hidden="true"></i></button>'; }).join('');
      set('#color-name', colorObj().name);
      $('#mats').innerHTML = btns(MATS, 'material', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      var sum = r.preparing ? r.type + ' · ' + r.level : summary();
      set('#summary', sum); set('#sb-sum', sum);
      var items = [['Tištěné díly podle STL projektu' + (r.setups ? (pair ? ' — leader i follower' : ' — follower') : ''), pair ? '2 sady' : '1 sada', 'Tisk']];
      if (st.tier !== 'parts') {
        if (r.id === 'so101') {
          items.push(['Servo Feetech STS3215 7,4 V, převod 1/345', pair ? '7×' : '6×', 'Hardware']);
          if (pair) { items.push(['Servo Feetech STS3215 7,4 V, převod 1/191', '2×', 'Hardware']); items.push(['Servo Feetech STS3215 7,4 V, převod 1/147', '3×', 'Hardware']); }
          items.push(['Řídicí deska serv', pair ? '2×' : '1×', 'Hardware'], ['Zdroj 5 V', pair ? '2×' : '1×', 'Hardware'], ['Kabel USB-C', '2×', 'Hardware'], ['Svěrky ke stolu', pair ? '4×' : '2×', 'Hardware']);
        } else { r.bom.forEach(function (b) { items.push([b[0], b[1], 'Hardware']); }); }
        items.push(['Spojovací materiál, roztříděný po krocích', '1 sada', 'Hardware']);
      }
      if (st.tier === 'tested') items.push(['Nastavení elektroniky a funkční test', '—', 'Servis']);
      items.push(['Tištěný návod a bezpečnostní informace', '1×', 'Návod']);
      set('#box-title', tierName() + ' · ' + items.length + ' položek');
      $('#box').innerHTML = items.map(function (it, i) { return '<li><span class="n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span>' + esc(it[0]) + '</span><span class="q">' + esc(it[1]) + '</span><span class="t">' + it[2] + '</span></li>'; }).join('');
      set('#box-note', r.id === 'so101' ? 'Počty dle kusovníku projektu SO-ARM100.' : 'Položky dle kusovníku projektu; přesné počty potvrdíme před expedicí.');
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      st[b.getAttribute('data-k')] = b.getAttribute('data-v');
      renderBuy(); syncUrl();
      if (b.getAttribute('data-k') === 'color') { renderImg(); if (viewer) viewer.setColor(colorObj().hex); }
    });
    renderImg(); renderBuy();
    if (fromQuiz) {
      var qn = $('#quiz-note'); qn.hidden = false;
      syncUrl();
    }

    var specs = r.specs.concat([['Náročnost', r.level], ['Software', r.software], ['Náklady na díly dle autora', r.bomCost]]).filter(function (s) { return s[1] && s[1] !== '—'; });
    set('#specs-title', 'Parametry · ' + specs.length);
    $('#specs').innerHTML = specs.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    var FAQ = [
      ['Zvládnu sestavení bez zkušeností?', 'Náročnost této sady: ' + r.level + '. Díly jsou roztříděné po krocích a návod vede krok za krokem. Pokud si nejste jistí, zvolte Sadu s oživením — elektroniku nastavíme za vás.'],
      ['Jak funguje předobjednávka?', 'Předobjednávka je nezávazná. Ozveme se e-mailem s cenou a termínem; platíte až po potvrzení objednávky.'],
      ['Je to originální produkt autorů projektu?', 'Ne. Sadu vyrábíme podle otevřené dokumentace projektu ' + r.name + ' (' + r.author + ', licence ' + r.hw + '). Autoři s námi nejsou spojeni a produkt neschválili.'],
      ['Jaký software budu potřebovat?', r.software + '. Software je open-source a zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'],
      ['Je sada vhodná pro děti?', 'Není to hračka. Obsahuje malé díly a elektroniku a je určena osobám od 14 let; mladší pouze pod dohledem dospělého, například ve škole nebo kroužku.'],
      ['Objednáváme pro školu nebo kroužek. Jde to na fakturu?', 'Ano. Do formuláře napište počet sad a IČO, cenu za více kusů a fakturu na školu pošleme spolu s potvrzením.']
    ];
    $('#faq-list').innerHTML = FAQ.map(function (f) { return '<details><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('');
    function relHtml(ids) {
      return ids.map(function (id) { var x = byId[id];
        return '<a href="' + href(x.id) + '">' + tile(x, 'white') + '<span class="card-meta mono"><span>' + no(x) + '</span><span>' + status(x) + '</span></span><b>' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + esc(x.short) + '</span></a>'; }).join('');
    }
    $('#related').innerHTML = relHtml(r.related);

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
      if (!consent.checked) { msg.hidden = false; msg.textContent = 'Potvrďte prosím souhlas se zpracováním e-mailu.'; consent.focus(); return; }
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
        : [['Do 2 pracovních dnů', 'Pošleme na ' + p.email + ' cenu a termín expedice pro ' + p.configuration + (p.qty > 1 ? ', ' + p.qty + ' ks' : '') + '.'], ['Po vašem potvrzení', 'Pošleme platební odkaz. Do té doby nic neplatíte a můžete zrušit.'], ['Tisk a kompletace', 'Díly vytiskneme, sadu zkompletujeme a pošleme s číslem zásilky.']];
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
    var slug = (qs('r') || (/\/sada\/([^\/?#]+)/.exec(location.pathname) || [])[1] || '').toLowerCase();
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
      ['Co od robota čekáte?', 'Cíl rozhoduje víc než cena.', [['ai', 'Učit se AI a robotiku', 'Trénovat modely, LeRobot'], ['school', 'Do školy nebo kroužku', 'Výuka pod vedením dospělého, 14+'], ['walk', 'Chci, aby chodil', 'Nohy místo kol'], ['rover', 'Rover jako na Marsu', 'Šest kol, terén venku'], ['lab', 'Výzkum, laboratoř', 'Přesnost, ROS 2']]],
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
      xle: ['Dvě ruce a mobilní základna', 'Ovládání přes VR či gamepad', 'Připravujeme']
    };
    // first pick per goal × experience × size; every available kit wins at least once
    var MATRIX = {
      ai:     { none: 'so101', some: { small: 'so101', mid: 'lekiwi', big: 'lekiwi' }, pro: { small: 'so101', mid: 'lekiwi', big: 'lekiwi' } },
      school: { none: 'otto', some: { small: 'otto', mid: 'so101', big: 'so101' }, pro: { small: 'so101', mid: 'spot', big: 'spot' } },
      walk:   { none: { small: 'otto', mid: 'otto', big: 'spot' }, some: { small: 'spot', mid: 'spot', big: 'duck' }, pro: 'duck' },
      rover:  { none: 'exomy', some: { small: 'exomy', mid: 'exomy', big: 'sawppy' }, pro: 'sawppy' },
      lab:    { none: 'so101', some: { small: 'hand', mid: 'so101', big: 'so101' }, pro: { small: 'hand', mid: 'thor', big: 'thor' } }
    };
    var FAMILY = { ai: ['so101', 'lekiwi', 'xle', 'hand'], school: ['otto', 'so101', 'spot'], walk: ['otto', 'spot', 'duck'], rover: ['exomy', 'sawppy', 'lekiwi'], lab: ['so101', 'hand', 'thor'] };
    function pick(a) {
      var exp = a[0], goal = a[1], size = a[2], m = MATRIX[goal][exp];
      var first = typeof m === 'string' ? m : m[size];
      var fam = FAMILY[goal].slice();
      if (goal === 'ai' && exp === 'pro' && size === 'big') fam = ['xle', 'so101', 'hand']; // flagship is still in preparation: offer it as the alternative
      return [first].concat(fam.filter(function (id) { return id !== first; })).slice(0, 3);
    }
    window.PR_QUIZ_PICK = pick; // exposed for automated checks
    // configuration handed to the product page
    function cfg(b, a) {
      var q = ['z=kviz'];
      if (b.preparing) return '?' + q.join('&');
      if (a[0] === 'none' && b.level !== 'Začátečník') q.push('tier=tested');
      if (b.setups && a[1] === 'school') q.push('setup=single');
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
          '<div class="q-opts" role="group" aria-labelledby="q-h">' + q[2].map(function (o, i) { return '<button type="button" class="q-opt" data-a="' + o[0] + '" aria-pressed="' + (ans[step] === o[0]) + '"><span class="mono">' + 'ABCDE'[i] + '</span><b>' + o[1] + '</b><span>' + o[2] + '</span></button>'; }).join('') + '</div>' +
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
          '</div></div><button type="button" id="restart" class="linkbtn" style="align-self:flex-start">Začít kvíz znovu</button></div></div>';
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

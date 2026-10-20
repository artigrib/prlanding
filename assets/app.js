(function () {
  'use strict';
  var R = window.PR_ROBOTS, C = window.PR_COLORS, CATS = window.PR_CATS, CFG = window.PR_CONFIG || {};
  var byId = {}; R.forEach(function (r, i) { r.idx = i; byId[r.id] = r; });
  var mobile = window.matchMedia('(max-width: 860px)');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function no(r) { return (r.idx < 9 ? '0' : '') + (r.idx + 1); }
  function src(r, color) { return r.render ? 'img/' + r.id + '_' + (color || 'white') + '.jpg' : (r.photo || ''); }
  function tile(r, color, extra, eager) {
    var s = src(r, color);
    var fb = r.render && color && color !== 'white' ? ' onerror="this.onerror=null;this.src=\'img/' + r.id + '_white.jpg\'"' : '';
    var inner = s ? '<img src="' + s + '" alt="' + esc(r.alt) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' width="1200" height="900"' + fb + '>'
      : '<div class="ph"><b>' + esc(r.name) + '</b><span class="mono-s">Vizualizace se připravuje</span></div>';
    return '<div class="tile">' + (extra || '') + inner + '</div>';
  }
  function $(sel) { return document.querySelector(sel); }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }
  function status(r) { return r.preparing ? 'Připravujeme' : 'Předobjednávka'; }

  /* footer contact */
  var fc = $('#footer-contact');
  if (fc && CFG.CONTACT_EMAIL) fc.innerHTML = '· <a href="mailto:' + esc(CFG.CONTACT_EMAIL) + '">' + esc(CFG.CONTACT_EMAIL) + '</a>';

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
    var filter = 'all';
    var FILTERS = [['all', 'Vše'], ['arm', 'Ruce a dlaně'], ['mobile', 'Mobilní'], ['legged', 'Kráčející']];
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
        return '<a class="card" href="sada.html?r=' + r.id + '">' + tile(r, 'white', '<span class="tag">' + status(r) + '</span>') +
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
    var r = byId[qs('r')] || byId.so101;
    var st = { setup: 'pair', tier: 'kit', color: 'white', material: 'pla' };
    var TIERS = [['parts', 'Tištěné díly', 'Hardware si obstaráte sami.'], ['kit', 'Kompletní sada', 'Díly a veškerý hardware dle kusovníku.', 1], ['tested', 'Sada s oživením', 'Elektronika nastavená a otestovaná.']];
    var MATS = [['pla', 'PLA+', 'Standard'], ['petg', 'PETG', 'Odolnější teplu']];

    document.title = 'Stavebnice pro ' + r.name + ' — printedrobotics.cz';
    var md = document.querySelector('meta[name=description]'); if (md) md.setAttribute('content', 'Stavebnice pro ' + r.name + ': vytištěné díly a kompletní hardware podle open-source projektu (' + r.author + ', ' + r.hw + '). ' + r.short);
    var canon = document.querySelector('link[rel=canonical]'); if (canon) canon.setAttribute('href', 'https://printedrobotics.cz/sada.html?r=' + r.id);
    var ld = document.createElement('script'); ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Stavebnice pro ' + r.name, description: r.lead, category: r.type,
      image: src(r, 'white') ? 'https://printedrobotics.cz/' + src(r, 'white') : undefined, brand: { '@type': 'Brand', name: 'printedrobotics.cz' },
      isBasedOn: r.repo, additionalProperty: r.specs.map(function (s) { return { '@type': 'PropertyValue', name: s[0], value: s[1] }; }) });
    document.head.appendChild(ld);

    function set(sel, txt) { var el = $(sel); if (el) el.textContent = txt; }
    set('#crumb-cat', CATS[r.cat]); set('#crumb-name', r.name);
    set('#p-no', 'N° ' + no(r) + ' — ' + r.type); set('#p-hw', r.hw); set('#p-name', r.name);
    set('#p-author', 'Open-source design: ' + r.author); set('#p-lead', r.lead);
    set('#p-credit', r.render ? 'Vizualizace z CAD projektu' : (r.credit || ''));
    set('#p-cap', 'Obr. 1 — ' + r.name);
    set('#l-name', r.name); set('#l-name2', r.name); set('#l-author', r.author); set('#l-hw', r.hw); set('#l-sw', r.sw); set('#l-hw2', r.hw); set('#l-sw2', r.sw);
    $('#l-repo').href = r.repo; $('#l-docs').href = r.docs;
    set('#sb-name', r.name);
    if (r.preparing) {
      $('#p-status span').textContent = 'Připravujeme · ověřujeme licenci s autory';
      $('#top-cta').firstChild.textContent = 'Dejte mi vědět ';
      set('#po-btn-t', 'Dejte mi vědět');
      $('#sbar .btn').textContent = 'Dejte mi vědět';
    }
    set('#po-title', r.preparing ? 'Upozornění na dostupnost' : 'Nezávazná předobjednávka');
    $('#po-prep').hidden = !r.preparing;

    function renderImg() { var t = $('#p-tile'); t.outerHTML = tile(r, st.color, '', true).replace('class="tile"', 'class="tile" id="p-tile"'); }
    function btns(list, key, cls, fmt) {
      return list.map(function (o) { return '<button type="button" class="' + cls + '" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (st[key] === o[0]) + '">' + fmt(o) + '</button>'; }).join('');
    }
    function renderBuy() {
      var pair = r.setups && st.setup === 'pair';
      $('#setups-wrap').hidden = !r.setups;
      $('#setups').innerHTML = btns([['pair', 'Pár', 'Leader + follower'], ['single', 'Follower', 'Jedna ruka']], 'setup', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      $('#tiers').innerHTML = btns(TIERS, 'tier', 'tier', function (o) { return '<i aria-hidden="true"></i><span><b>' + o[1] + '</b>' + (o[3] ? '<span class="badge">Nejčastější volba</span>' : '') + '<small>' + o[2] + '</small></span>'; });
      $('#colors').innerHTML = C.map(function (c) { return '<button type="button" class="sw" data-k="color" data-v="' + c.id + '" aria-pressed="' + (st.color === c.id) + '" aria-label="' + c.name + '"><i style="background:' + c.hex + '" aria-hidden="true"></i></button>'; }).join('');
      var colorName = C.filter(function (c) { return c.id === st.color; })[0].name;
      set('#color-name', colorName);
      $('#mats').innerHTML = btns(MATS, 'material', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      var tierName = TIERS.filter(function (t) { return t[0] === st.tier; })[0][1];
      var sum = (r.setups ? (pair ? 'Pár · ' : 'Follower · ') : '') + tierName + ' · ' + colorName;
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
      set('#box-title', tierName + ' · ' + items.length + ' položek');
      $('#box').innerHTML = items.map(function (it, i) { return '<li><span class="n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span>' + esc(it[0]) + '</span><span class="q">' + esc(it[1]) + '</span><span class="t">' + it[2] + '</span></li>'; }).join('');
      set('#box-note', r.id === 'so101' ? 'Počty dle kusovníku projektu SO-ARM100.' : 'Položky dle kusovníku projektu; přesné počty potvrdíme před expedicí.');
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      st[b.getAttribute('data-k')] = b.getAttribute('data-v');
      renderBuy(); if (b.getAttribute('data-k') === 'color') renderImg();
    });
    renderImg(); renderBuy();

    var specs = r.specs.concat([['Náročnost', r.level], ['Software', r.software], ['Náklady na díly dle autora', r.bomCost]]).filter(function (s) { return s[1] && s[1] !== '—'; });
    set('#specs-title', 'Parametry · ' + specs.length);
    $('#specs').innerHTML = specs.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    var FAQ = [
      ['Zvládnu sestavení bez zkušeností?', 'Náročnost této sady: ' + r.level + '. Díly jsou roztříděné po krocích a návod vede krok za krokem. Pokud si nejste jistí, zvolte Sadu s oživením — elektroniku nastavíme za vás.'],
      ['Jak funguje předobjednávka?', 'Předobjednávka je nezávazná. Ozveme se e-mailem s cenou a termínem; platíte až po potvrzení objednávky.'],
      ['Je to originální produkt autorů projektu?', 'Ne. Sadu vyrábíme podle otevřené dokumentace projektu ' + r.name + ' (' + r.author + ', licence ' + r.hw + '). Autoři s námi nejsou spojeni a produkt neschválili.'],
      ['Jaký software budu potřebovat?', r.software + '. Software je open-source a zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'],
      ['Je sada vhodná pro děti?', 'Není to hračka. Obsahuje malé díly a elektroniku a je určena osobám od 14 let; mladší pouze pod dohledem dospělého, například ve škole nebo kroužku.']
    ];
    $('#faq-list').innerHTML = FAQ.map(function (f) { return '<details><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('');
    $('#related').innerHTML = r.related.map(function (id) { var x = byId[id];
      return '<a href="sada.html?r=' + x.id + '">' + tile(x, 'white') + '<span class="card-meta mono"><span>' + no(x) + '</span><span>' + status(x) + '</span></span><b>' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + esc(x.short) + '</span></a>'; }).join('');

    /* collapsible sections: open on desktop; on mobile only the flagged one */
    var accs = document.querySelectorAll('details.acc');
    function syncAcc() { accs.forEach(function (d) { d.open = !mobile.matches || d.hasAttribute('data-mobile-open'); }); }
    syncAcc(); mobile.addEventListener ? mobile.addEventListener('change', syncAcc) : mobile.addListener(syncAcc);
    accs.forEach(function (d) { d.querySelector('summary').addEventListener('click', function (e) { if (!mobile.matches) e.preventDefault(); }); });
    // jump links open their collapsed section
    document.querySelectorAll('.jump a').forEach(function (a) {
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

    /* pre-order form */
    var form = $('#preorder'), msg = $('#form-msg'), btn = $('#po-btn'), email = $('#po-email'), err = $('#po-email-err'), consent = $('#po-consent');
    function validEmail() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()); }
    function showErr(on) { err.hidden = !on; email.setAttribute('aria-invalid', on ? 'true' : 'false'); email.style.borderColor = on ? '#B33A16' : ''; }
    email.addEventListener('blur', function () { if (email.value) showErr(!validEmail()); });
    email.addEventListener('input', function () { if (!err.hidden && validEmail()) showErr(false); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validEmail()) { showErr(true); email.focus(); return; }
      if (!consent.checked) { msg.hidden = false; msg.textContent = 'Potvrďte prosím souhlas se zpracováním e-mailu.'; consent.focus(); return; }
      var payload = { email: email.value.trim(), note: form.note.value, robot: r.name, setup: r.setups ? st.setup : '', tier: st.tier, color: st.color, material: st.material, type: r.preparing ? 'notify' : 'preorder' };
      if (!CFG.FORM_ENDPOINT) { msg.hidden = false; msg.textContent = 'Předobjednávky spouštíme během několika dní. Zatím jsme nic neodeslali — zkuste to prosím brzy znovu.'; return; }
      btn.disabled = true; msg.hidden = false; msg.textContent = 'Odesíláme…';
      fetch(CFG.FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          $('#po-wrap').innerHTML = '<div class="form-ok" role="status" tabindex="-1" id="po-ok"><span class="mono">Hotovo</span><b>Děkujeme, máme to.</b><span class="ink2">Ozveme se na ' + esc(payload.email) + ' s cenou a termínem pro ' + esc(r.name) + '.</span></div>';
          $('#po-ok').focus();
        })
        .catch(function () { msg.textContent = 'Odeslání se nezdařilo. Zkuste to prosím znovu.'; btn.disabled = false; });
    });
  }

  /* ---------- quiz ---------- */
  if (page === 'quiz') {
    var Q = [
      ['Stavěli jste už něco podobného?', 'Podle zkušenosti zvolíme náročnost.', [['none', 'Ještě nikdy', 'Šroubovák zvládnu, pájku ne'], ['some', 'Něco málo', '3D tisk, Arduino, Raspberry Pi'], ['pro', 'Ano, pravidelně', 'ROS, Python, elektronika']]],
      ['Co od robota čekáte?', 'Cíl rozhoduje víc než cena.', [['ai', 'Učit se AI a robotiku', 'Trénovat modely, LeRobot'], ['school', 'Do školy nebo kroužku', 'Výuka pod vedením dospělého, 14+'], ['walk', 'Chci, aby chodil', 'Nohy místo kol'], ['lab', 'Výzkum, laboratoř', 'Přesnost, ROS 2']]],
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
      xle: ['Dvě ruce a mobilní základna', 'Ovládání přes VR či gamepad', 'Připravujeme']
    };
    function pick(a) {
      var exp = a[0], goal = a[1], size = a[2];
      if (goal === 'school') return ['otto', 'so101', 'spot'];
      if (goal === 'walk') return exp === 'pro' || size === 'big' ? ['duck', 'spot', 'otto'] : exp === 'none' ? ['otto', 'spot', 'duck'] : ['spot', 'duck', 'otto'];
      if (goal === 'lab') return size === 'small' ? ['so101', 'hand', 'thor'] : exp === 'pro' ? ['thor', 'so101', 'hand'] : ['so101', 'thor', 'hand'];
      if (size === 'big' && exp === 'pro') return ['lekiwi', 'xle', 'hand'];
      if (size === 'mid' && exp !== 'none') return ['lekiwi', 'so101', 'hand'];
      return ['so101', 'lekiwi', 'hand'];
    }
    var step = 0, ans = [];
    function render() {
      var root = $('#quiz');
      if (step < Q.length) {
        var q = Q[step];
        root.innerHTML = '<div class="g" style="padding-top:24px;row-gap:12px"><div class="a1 mono">Otázka ' + (step + 1) + ' ze 3</div><div class="a4 progress" aria-hidden="true">' + [0, 1, 2].map(function (i) { return '<i class="' + (i <= step ? 'on' : '') + '"></i>'; }).join('') + '</div></div>' +
          '<div class="g" style="margin-top:clamp(24px,6vw,96px);row-gap:24px"><div class="a1 big-num hide-s" aria-hidden="true">0' + (step + 1) + '</div><div class="a4" style="display:flex;flex-direction:column;gap:28px">' +
          '<div><h1 class="h2" style="font-size:clamp(28px,4.4vw,64px)" tabindex="-1" id="q-h">' + q[0] + '</h1><p class="lead muted" style="margin-top:8px">' + q[1] + '</p></div>' +
          '<div class="q-opts" role="group" aria-labelledby="q-h">' + q[2].map(function (o, i) { return '<button type="button" class="q-opt" data-a="' + o[0] + '"><span class="mono">' + 'ABCD'[i] + '</span><b>' + o[1] + '</b><span>' + o[2] + '</span></button>'; }).join('') + '</div>' +
          (step ? '<div style="border-top:1px solid var(--line);padding-top:12px"><button type="button" id="back" class="linkbtn">← Zpět</button></div>' : '') + '</div></div>';
        if (step) $('#q-h').focus();
      } else {
        var res = pick(ans), b = byId[res[0]];
        root.innerHTML = '<div class="g" style="padding-top:24px;row-gap:8px"><div class="a1 mono">Výsledek</div><div class="a4 mono">' + ans.map(function (id, i) { return Q[i][2].filter(function (o) { return o[0] === id; })[0][1]; }).join(' · ') + '</div></div>' +
          '<div class="g" style="margin-top:clamp(24px,5vw,72px);row-gap:24px"><div class="a1 hide-s" style="display:flex;flex-direction:column;gap:12px"><span class="mono">Doporučujeme</span></div>' +
          '<div class="a4" style="display:flex;flex-direction:column;gap:56px"><div class="res">' + tile(b, 'white', '', true) +
          '<div style="display:flex;flex-direction:column;gap:14px"><div class="card-meta mono"><span>' + b.level + '</span><span>' + status(b) + '</span></div><span class="muted" style="font-size:17px">Doporučujeme stavebnici pro</span><h1 class="p-name" style="margin-top:-6px" tabindex="-1" id="q-h">' + esc(b.name) + '</h1>' +
          '<ul class="reasons">' + REASONS[b.id].map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ul>' +
          '<a class="btn btn-act" href="sada.html?r=' + b.id + '#predobjednavka">' + (b.preparing ? 'Dejte mi vědět' : 'Předobjednat') + ' <span aria-hidden="true">→</span></a>' +
          '<a class="btn btn-o" href="sada.html?r=' + b.id + '">Detail sady <span aria-hidden="true">→</span></a></div></div>' +
          '<div><div class="mono" style="border-top:1px solid var(--ink);padding-top:12px;margin-bottom:16px">Také by vás mohlo bavit</div><div class="alts">' +
          res.slice(1).map(function (id) { var x = byId[id]; return '<a href="sada.html?r=' + x.id + '">' + tile(x, 'white') + '<span><b style="font-size:21px;font-weight:500;letter-spacing:-.03em;display:block">' + esc(x.name) + '</b><span class="muted" style="font-size:15px">' + x.level + ' · ' + esc(x.type) + '</span></span></a>'; }).join('') +
          '</div></div><button type="button" id="restart" class="linkbtn" style="align-self:flex-start">Začít kvíz znovu</button></div></div>';
        $('#q-h').focus();
      }
    }
    $('#quiz').addEventListener('click', function (e) {
      var o = e.target.closest('[data-a]');
      if (o) { ans = ans.slice(0, step); ans[step] = o.getAttribute('data-a'); step++; render(); window.scrollTo(0, 0); return; }
      if (e.target.closest('#back') && step > 0) { step--; render(); return; }
      if (e.target.closest('#restart')) { step = 0; ans = []; render(); window.scrollTo(0, 0); }
    });
    render();
  }
})();

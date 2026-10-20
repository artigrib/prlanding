(function () {
  'use strict';
  var R = window.PR_ROBOTS, C = window.PR_COLORS, CATS = window.PR_CATS, CFG = window.PR_CONFIG || {};
  var byId = {}; R.forEach(function (r, i) { r.idx = i; byId[r.id] = r; });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function no(r) { return (r.idx < 9 ? '0' : '') + (r.idx + 1); }
  function src(r, color) { return r.render ? 'img/' + r.id + '_' + (color || 'white') + '.jpg' : (r.photo || ''); }
  function tile(r, color, extra) {
    var s = src(r, color);
    var fb = r.render && color && color !== 'white' ? ' onerror="this.onerror=null;this.src=\'img/' + r.id + '_white.jpg\'"' : '';
    var inner = s ? '<img src="' + s + '" alt="' + esc(r.alt) + '" loading="lazy" width="1200" height="900"' + fb + '>'
      : '<div class="ph"><b>' + esc(r.name) + '</b><span class="mono-s">Vizualizace se připravuje</span></div>';
    return '<div class="tile">' + (extra || '') + inner + '</div>';
  }
  function $(sel) { return document.querySelector(sel); }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }

  // footer contact
  var fc = $('#footer-contact');
  if (fc && CFG.CONTACT_EMAIL) fc.innerHTML = '· <a href="mailto:' + esc(CFG.CONTACT_EMAIL) + '">' + esc(CFG.CONTACT_EMAIL) + '</a>';

  var page = document.body.getAttribute('data-page');

  /* ---------- catalogue (home) ---------- */
  if (page === 'home') {
    var filter = 'all';
    var FILTERS = [['all', 'Vše'], ['arm', 'Ruce a dlaně'], ['mobile', 'Mobilní'], ['legged', 'Kráčející']];
    function renderFilters() {
      $('#filters').innerHTML = FILTERS.map(function (f) {
        var n = f[0] === 'all' ? R.length : R.filter(function (r) { return r.cat === f[0]; }).length;
        return '<button type="button" class="filter" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '"><i aria-hidden="true"></i>' + f[1] + '<small>' + (n < 10 ? '0' : '') + n + '</small></button>';
      }).join('');
    }
    function renderCards() {
      $('#cards').innerHTML = R.filter(function (r) { return filter === 'all' || r.cat === filter; }).map(function (r) {
        var tag = '<span class="tag">' + (r.preparing ? 'Připravujeme' : 'Předobjednávka') + '</span>';
        return '<article class="card">' + tile(r, 'white', tag) +
          '<div class="card-meta"><span class="mono" style="color:var(--ink)">' + no(r) + '</span><span class="mono-s">' + esc(r.hw) + '</span></div>' +
          '<div><h3>' + esc(r.name) + '</h3><div class="muted" style="font-size:15px;margin-top:6px">' + esc(r.type) + ' · ' + esc(r.level) + '</div></div>' +
          '<p>' + esc(r.short) + '</p>' +
          '<dl class="dl2">' + r.card.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('') + '</dl>' +
          '<div class="card-foot"><a class="btn btn-o" href="sada.html?r=' + r.id + '">Detail sady <span aria-hidden="true">→</span></a>' +
          '<a class="mono" style="color:var(--ink);text-decoration:none;padding:12px 0" href="' + esc(r.repo) + '" rel="noopener">Zdroj ↗</a></div></article>';
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

    $('#crumb-cat').textContent = CATS[r.cat];
    $('#crumb-name').textContent = r.name;
    $('#p-no').textContent = 'N° ' + no(r) + ' — ' + r.type;
    $('#p-hw').textContent = r.hw;
    $('#p-name').textContent = r.name;
    $('#p-author').textContent = 'Open-source design: ' + r.author;
    $('#p-lead').textContent = r.lead;
    $('#p-credit').textContent = r.render ? 'Vizualizace: printedrobotics.cz z CAD projektu' : (r.credit || '');
    $('#p-cap').textContent = 'Obr. 1 — ' + r.name;
    ['#l-name', '#l-name2'].forEach(function (s) { $(s).textContent = r.name; });
    $('#l-author').textContent = r.author; $('#l-hw').textContent = r.hw; $('#l-sw').textContent = r.sw;
    $('#l-hw2').textContent = r.hw; $('#l-sw2').textContent = r.sw;
    $('#l-repo').href = r.repo; $('#l-docs').href = r.docs;

    function renderImg() { $('#p-tile').outerHTML = tile(r, st.color).replace('class="tile"', 'class="tile" id="p-tile"'); }
    function btns(list, key, cls, fmt) {
      return list.map(function (o) { return '<button type="button" class="' + cls + '" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (st[key] === o[0]) + '">' + fmt(o) + '</button>'; }).join('');
    }
    function renderBuy() {
      var pair = r.setups && st.setup === 'pair';
      $('#setups-wrap').hidden = !r.setups;
      $('#setups').innerHTML = btns([['pair', 'Pár', 'Leader + follower'], ['single', 'Follower', 'Jedna ruka']], 'setup', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      $('#tiers').innerHTML = btns(TIERS, 'tier', 'tier', function (o) { return '<i aria-hidden="true"></i><span><b>' + o[1] + '</b>' + (o[3] ? '<span class="badge">Nejčastější volba</span>' : '') + '<small>' + o[2] + '</small></span>'; });
      $('#colors').innerHTML = C.map(function (c) { return '<button type="button" class="sw" data-k="color" data-v="' + c.id + '" aria-pressed="' + (st.color === c.id) + '" aria-label="' + c.name + '"><i style="background:' + c.hex + '" aria-hidden="true"></i></button>'; }).join('');
      $('#color-name').textContent = C.filter(function (c) { return c.id === st.color; })[0].name;
      $('#mats').innerHTML = btns(MATS, 'material', 'opt', function (o) { return o[1] + '<span>' + o[2] + '</span>'; });
      var tierName = TIERS.filter(function (t) { return t[0] === st.tier; })[0][1];
      $('#summary').textContent = (r.setups ? (pair ? 'Pár, ' : 'Follower, ') : '') + tierName;
      // box contents
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
      $('#box-title').textContent = tierName + (r.setups ? (pair ? ' — pár leader + follower.' : ' — follower.') : '.');
      $('#box').innerHTML = items.map(function (it, i) { return '<li><span class="n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span>' + esc(it[0]) + '</span><span class="q">' + esc(it[1]) + '</span><span class="t">' + it[2] + '</span></li>'; }).join('');
      $('#box-note').textContent = r.id === 'so101' ? 'Počty dle kusovníku projektu SO-ARM100.' : 'Položky dle kusovníku projektu; přesné počty potvrdíme před expedicí.';
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      st[b.getAttribute('data-k')] = b.getAttribute('data-v');
      renderBuy(); if (b.getAttribute('data-k') === 'color') renderImg();
    });
    renderImg(); renderBuy();

    var specs = r.specs.concat([['Náročnost', r.level], ['Software', r.software], ['Náklady na díly dle autora', r.bomCost]]);
    $('#specs').innerHTML = specs.filter(function (s) { return s[1] && s[1] !== '—'; }).map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    var FAQ = [
      ['Zvládnu sestavení bez zkušeností?', 'Náročnost této sady: ' + r.level + '. Díly jsou roztříděné po krocích a návod vede krok za krokem. Pokud si nejste jistí, zvolte Sadu s oživením — elektroniku nastavíme za vás.'],
      ['Je to originální produkt autorů projektu?', 'Ne. Sadu vyrábíme podle otevřené dokumentace projektu ' + r.name + ' (' + r.author + ', licence ' + r.hw + '). Autoři s námi nejsou spojeni a produkt neschválili.'],
      ['Jaký software budu potřebovat?', r.software + '. Software je open-source a zdarma; odkaz na návod projektu najdete v sekci Projekt a licence.'],
      ['Jak funguje předobjednávka?', 'Předobjednávka je nezávazná. Ozveme se e-mailem s cenou a termínem; platíte až po potvrzení objednávky.'],
      ['Je sada vhodná pro děti?', 'Není to hračka. Obsahuje malé díly a elektroniku a je určena osobám od 14 let; mladší pouze pod dohledem dospělého, například ve škole nebo kroužku.']
    ];
    $('#faq').innerHTML = FAQ.map(function (f) { return '<details><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('');
    $('#related').innerHTML = r.related.map(function (id) { var x = byId[id];
      return '<a href="sada.html?r=' + x.id + '">' + tile(x, 'white') + '<span class="card-meta mono-s"><span>' + no(x) + '</span><span>' + esc(x.hw) + '</span></span><b>' + esc(x.name) + '</b><span class="muted" style="font-size:14px">' + esc(x.short) + '</span></a>'; }).join('');

    // pre-order form
    var form = $('#preorder'), msg = $('#form-msg'), btn = $('#po-btn'), consent = $('#po-consent');
    $('#po-title').textContent = r.preparing ? 'Dejte mi vědět, až bude sada k dispozici' : 'Nezávazná předobjednávka';
    btn.firstChild.textContent = r.preparing ? 'Dejte mi vědět ' : 'Předobjednat ';
    $('#po-prep').hidden = !r.preparing;
    consent.addEventListener('change', function () { btn.disabled = !consent.checked; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.hidden = false; msg.textContent = 'Zkontrolujte prosím e-mailovou adresu.'; form.email.focus(); return; }
      var payload = { email: email, note: form.note.value, robot: r.name, setup: r.setups ? st.setup : '', tier: st.tier, color: st.color, material: st.material, type: r.preparing ? 'notify' : 'preorder' };
      if (!CFG.FORM_ENDPOINT) { msg.hidden = false; msg.textContent = 'Předobjednávky spouštíme během několika dní. Zatím jsme nic neodeslali — zkuste to prosím brzy znovu.'; return; }
      btn.disabled = true; msg.hidden = false; msg.textContent = 'Odesíláme…';
      fetch(CFG.FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (res) { if (!res.ok) throw new Error(res.status); msg.textContent = 'Děkujeme! Ozveme se na ' + email + ' s cenou a termínem.'; form.reset(); })
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
        root.innerHTML = '<div class="g" style="padding-top:40px;row-gap:24px"><div class="a1 mono">Otázka 0' + (step + 1) + ' / 03</div><div class="a4 progress">' + [0, 1, 2].map(function (i) { return '<i class="' + (i <= step ? 'on' : '') + '"></i>'; }).join('') + '</div></div>' +
          '<div class="g" style="margin-top:clamp(56px,7vw,96px);row-gap:48px"><div class="a1 big-num" aria-hidden="true">0' + (step + 1) + '</div><div class="a4" style="display:flex;flex-direction:column;gap:48px">' +
          '<div><h1 class="h2" style="font-size:clamp(36px,4.4vw,64px)">' + q[0] + '</h1><p class="lead muted" style="margin-top:12px">' + q[1] + '</p></div>' +
          '<div class="q-opts" role="group" aria-label="' + esc(q[0]) + '">' + q[2].map(function (o, i) { return '<button type="button" class="q-opt" data-a="' + o[0] + '"><span class="mono">' + 'ABCD'[i] + '</span><b>' + o[1] + '</b><span>' + o[2] + '</span></button>'; }).join('') + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:20px"><button type="button" id="back" class="filter" style="width:auto;border:0" ' + (step ? '' : 'disabled') + '>← Zpět</button><span class="mono">Vyberte jednu možnost</span></div></div></div>';
        var first = root.querySelector('.q-opt'); if (first && step) first.focus();
      } else {
        var res = pick(ans), b = byId[res[0]];
        root.innerHTML = '<div class="g" style="padding-top:40px;row-gap:24px"><div class="a1 mono">Výsledek</div><div class="a4 mono">' + ans.map(function (id, i) { return Q[i][2].filter(function (o) { return o[0] === id; })[0][1]; }).join(' · ') + '</div></div>' +
          '<div class="g" style="margin-top:72px;row-gap:48px"><div class="a1" style="display:flex;flex-direction:column;gap:12px"><span class="mono">Doporučujeme</span><button type="button" id="restart" class="filter" style="width:auto;border:0;text-decoration:underline">Začít znovu</button></div>' +
          '<div class="a4" style="display:flex;flex-direction:column;gap:72px"><div class="res">' + tile(b, 'white') +
          '<div style="display:flex;flex-direction:column;gap:16px"><div class="card-meta mono"><span>' + b.level + '</span><span>' + esc(b.hw) + '</span></div><span class="muted" style="font-size:18px">Stavebnice pro</span><h1 class="p-name" style="margin-top:-8px">' + esc(b.name) + '</h1>' +
          '<ul class="reasons">' + REASONS[b.id].map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ul>' +
          '<a class="btn" href="sada.html?r=' + b.id + '">Zobrazit sadu ' + esc(b.name) + ' <span aria-hidden="true">→</span></a></div></div>' +
          '<div><div class="mono" style="border-top:1px solid var(--ink);padding-top:12px;margin-bottom:24px">Také by vás mohlo bavit</div><div class="alts">' +
          res.slice(1).map(function (id) { var x = byId[id]; return '<a href="sada.html?r=' + x.id + '">' + tile(x, 'white') + '<span><b style="font-size:22px;font-weight:500;letter-spacing:-.03em;display:block">' + esc(x.name) + '</b><span class="muted" style="font-size:14px">' + x.level + ' · ' + esc(x.type) + '</span></span></a>'; }).join('') +
          '</div></div></div></div>';
      }
    }
    $('#quiz').addEventListener('click', function (e) {
      var o = e.target.closest('[data-a]');
      if (o) { ans = ans.slice(0, step); ans[step] = o.getAttribute('data-a'); step++; render(); window.scrollTo(0, 0); return; }
      if (e.target.closest('#back') && step > 0) { step--; render(); return; }
      if (e.target.closest('#restart')) { step = 0; ans = []; render(); }
    });
    render();
  }
})();

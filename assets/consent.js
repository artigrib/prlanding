/* printedrobotics.cz consent banner, loaded by assets/track.js only when it is needed (first visit, or the
 * "Nastavení soukromí" link). Two equal buttons, nothing pre-selected, never blocks the page. */
(function (w, d) {
  'use strict';
  var T = {
    cs: ['Soukromí', 'Smíme měřit, jak se web a simulace používají? Jen anonymní statistiky, třeba kolik lidí dokončí misi. Žádné reklamy, žádná jména ani e-maily. Volbu můžete kdykoli změnit v Nastavení soukromí.',
      'Odmítnout', 'Povolit analytiku', 'Zásady soukromí', 'Teď: ', 'povoleno', 'odmítnuto', 'Váš prohlížeč posílá signál „Nesledovat“, a tak nic neměříme.', 'Zavřít', '/soukromi/'],
    en: ['Privacy', 'May we measure how the site and simulations are used? Anonymous statistics only, such as how many people finish a mission. No ads, no names or e-mails. You can change this any time in Privacy settings.',
      'Decline', 'Allow analytics', 'Privacy policy', 'Now: ', 'allowed', 'declined', 'Your browser sends “Do Not Track”, so we measure nothing.', 'Close', '/en/privacy/']
  };
  var CSS = '.prc{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:540px;margin:0 auto;box-sizing:border-box;background:#fff;color:#141414;border:1px solid;border-radius:12px;padding:16px;font:15px/1.45 "Inter Tight",system-ui,sans-serif;box-shadow:0 8px 32px #0003;text-align:left}' +
    '.prc p{margin:0 0 12px}.prc a{color:inherit;text-decoration:underline}.prc div{display:flex;gap:8px;flex-wrap:wrap}' +
    '.prc div button{flex:1 1 150px;min-height:44px;margin:0;font:inherit;font-weight:600;border-radius:8px;border:2px solid #141414;background:#141414;color:#fff;cursor:pointer}' +
    '.prc :focus-visible,.prc-f:focus-visible{outline:3px solid #E8461E;outline-offset:2px}@media print{.prc{display:none}}';
  var st = d.createElement('style');
  st.textContent = CSS;
  d.head.appendChild(st);
  var box = null;
  function close(back) { if (box) { box.remove(); box = null; } if (back && back.focus) back.focus(); }

  /* api: { state(), decide(v), dnt, en } from track.js; back: the element that opened the settings */
  w.prConsentUI = function (api, back) {
    close();
    var t = T[api.en() ? 'en' : 'cs'], now = api.state(), dnt = api.dnt;
    box = d.createElement('section');
    box.className = 'prc';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', t[0]);
    box.innerHTML = '<p>' + (dnt ? t[8] : t[1] + (now ? ' <b>' + t[5] + t[now === 'granted' ? 6 : 7] + '.</b>' : '')) +
      ' <a href="' + t[10] + '">' + t[4] + '</a></p><div>' +
      (dnt ? '<button type="button">' + t[9] + '</button>'
        : '<button type="button" data-v="denied">' + t[2] + '</button><button type="button" data-v="granted">' + t[3] + '</button>') + '</div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-v')) api.decide(b.getAttribute('data-v'));
      close(back);
    });
    d.body.appendChild(box);
    if (back) box.querySelector('button').focus();
  };
  w.prConsentUI.close = close;
})(window, document);

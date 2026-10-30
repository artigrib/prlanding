/* printedrobotics.cz – i18n core (Czech default, English second).
 *
 * Works as a classic <script> on site pages and as a side-effect `import` in the sims
 * (sim/so101 native modules, sim/arena via esbuild): no import/export, sets globalThis.PRI18N.
 *
 * Approach (gettext style): the Czech source text IS the key. Czech pages never translate
 * anything, so Czech output stays byte-identical. English dictionaries map Czech → English:
 *   { strings: { 'Czech text': 'English text', … }, patterns: [[/^Úloha (\d+) z (\d+)$/, 'Task $1 of $2'], …] }
 * Untranslated text falls back to Czech (and is reported by tests/smoke-en.mjs).
 *
 * Language:
 *   site pages – path based: /en/… pages carry <html lang="en">, everything else is Czech.
 *   sims       – ?lang=en|cs, else the visitor's saved choice (localStorage pr-lang), else Czech.
 * Never redirects. Accept-Language is only used for a one-time, dismissible suggestion banner.
 */
(function (G) {
  'use strict';
  if (G.PRI18N) return;
  var KEY = 'pr-lang', BANNER_KEY = 'pr-lang-banner';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function qsLang() { var m = /[?&]lang=(cs|en)\b/.exec(G.location ? G.location.search : ''); return m ? m[1] : null; }

  var dicts = { en: { strings: {}, patterns: [] } };
  var lang = 'cs';
  function norm(s) { return String(s).replace(/[ ⁠ ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  function addDict(l, d) {
    var t = dicts[l] || (dicts[l] = { strings: {}, patterns: [] });
    if (d && d.strings) Object.keys(d.strings).forEach(function (k) { t.strings[norm(k)] = d.strings[k]; });
    if (d && d.patterns) t.patterns = t.patterns.concat(d.patterns);
  }
  function lookup(s) {
    var d = dicts[lang]; if (!d) return null;
    var k = norm(s); if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(d.strings, k)) return d.strings[k];
    for (var i = 0; i < d.patterns.length; i++) {
      var p = d.patterns[i]; if (p[0].test(k)) return k.replace(p[0], p[1]);
    }
    // "A · B · C": translate the pieces (status lines, summaries, hints)
    if (k.indexOf(' · ') > 0) {
      var parts = k.split(' · '), hit = false;
      parts = parts.map(function (x) { var r = lookup(x); if (r != null) { hit = true; return r; } return x; });
      if (hit) return parts.join(' · ');
    }
    return null;
  }
  /* t('Czech', {n: 3}) → English when lang is en; {name} placeholders are filled in either language */
  function t(s, vars) {
    var out = lang === 'cs' ? s : (lookup(s) == null ? s : lookup(s));
    if (vars) out = String(out).replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
    return out;
  }

  /* DOM translation: text nodes and a few attributes whose whole (trimmed) value is a key */
  var ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'data-tip', 'data-label', 'content'];
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|NOSCRIPT)$/;
  function trText(n) {
    var v = n.nodeValue; if (!v || !/\S/.test(v)) return;
    var r = lookup(v); if (r == null || r === norm(v)) return;
    var lead = /^\s*/.exec(v)[0], tail = /\s*$/.exec(v)[0];
    n.nodeValue = lead + r + tail;
  }
  function trEl(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i]; if (!el.hasAttribute(a)) continue;
      if (a === 'content' && el.nodeName !== 'META') continue;
      var r = lookup(el.getAttribute(a)); if (r != null && r !== el.getAttribute(a)) el.setAttribute(a, r);
    }
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) { var rv = lookup(el.value); if (rv != null) el.value = rv; }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!root.parentNode || !SKIP.test(root.parentNode.nodeName)) trText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { trEl(root); if (SKIP.test(root.nodeName)) return; }
    var w = (root.ownerDocument || root).createTreeWalker(root, 5 /* element | text */, null), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) trEl(n);
      else if (!SKIP.test(n.parentNode.nodeName)) trText(n);
    }
  }
  var observer = null;
  function observe(root) {
    if (lang === 'cs' || observer || typeof MutationObserver === 'undefined') return;
    root = root || document.documentElement;
    walk(root);
    if (document.title) { var tt = lookup(document.title); if (tt) document.title = tt; }
    observer = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'childList') for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        else if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') trEl(m.target);
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    // <title> changes come through childList of <title>, handled by walk() on its text node
  }

  /* ---------- language detection ---------- */
  function detect(kind) {
    var html = G.document && document.documentElement.getAttribute('lang');
    if (kind === 'site') return html === 'en' ? 'en' : 'cs';
    return qsLang() || (store(KEY) === 'en' ? 'en' : null) || 'cs';
  }
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'cs';
    if (G.document && document.documentElement.getAttribute('lang') !== lang) document.documentElement.setAttribute('lang', lang);
    return lang;
  }

  /* ---------- alternates, switcher, suggestion banner (site pages) ---------- */
  function alternates() {
    var out = {};
    if (!G.document) return out;
    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(function (l) { out[l.getAttribute('hreflang')] = l.getAttribute('href'); });
    return out;
  }
  function rel(url) { // absolute site URL → same-origin path so local previews work too
    try { var u = new URL(url, location.href); return u.origin === location.origin || /printedrobotics\.cz$/.test(u.hostname) ? u.pathname + u.search + location.hash : url; } catch (e) { return url; }
  }
  function remember(l) { store(KEY, l); }
  function wireSwitcher() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-lang]'); if (a) remember(a.getAttribute('data-lang'));
    });
  }
  // fills <span class="lang-sw" data-lang-switch></span> placeholders (build.mjs prerenders them; sims mount their own)
  function switcherHtml(cur, hrefs) {
    return ['cs', 'en'].map(function (l) {
      var label = l === 'cs' ? 'CZ' : 'EN', name = l === 'cs' ? 'Čeština' : 'English';
      return l === cur ? '<span aria-current="true" lang="' + l + '" title="' + name + '">' + label + '</span>'
        : '<a href="' + hrefs[l] + '" hreflang="' + l + '" lang="' + l + '" data-lang="' + l + '" title="' + name + '">' + label + '</a>';
    }).join('<span class="sep" aria-hidden="true">/</span>');
  }
  function banner() {
    if (!G.document || store(BANNER_KEY) || store(KEY) === lang) return;
    var alt = alternates(), other = lang === 'cs' ? 'en' : 'cs';
    if (!alt[other]) return;
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map(function (x) { return String(x).toLowerCase(); });
    var wantsCs = /^(cs|sk)/.test(langs[0] || '');
    var saved = store(KEY);
    // suggest only when the browser (or an earlier explicit choice) prefers the other language
    if (!(saved === other || (lang === 'cs' && !wantsCs && langs.some(function (x) { return /^en/.test(x); })) || (lang === 'en' && wantsCs))) return;
    var b = document.createElement('div');
    b.className = 'lang-banner'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', other === 'en' ? 'Language' : 'Jazyk');
    b.lang = other;
    b.innerHTML = other === 'en'
      ? '<span>This page is also available in English.</span><a href="' + rel(alt.en) + '" data-lang="en">Switch to English</a><button type="button" aria-label="Dismiss">✕</button>'
      : '<span>Tato stránka je k dispozici i v češtině.</span><a href="' + rel(alt.cs) + '" data-lang="cs">Přepnout do češtiny</a><button type="button" aria-label="Zavřít">✕</button>';
    b.querySelector('button').addEventListener('click', function () { store(BANNER_KEY, '1'); b.remove(); });
    b.querySelector('a').addEventListener('click', function () { store(BANNER_KEY, '1'); });
    // fixed overlay at the bottom: no layout shift (CLS) when it appears after first paint
    document.body.appendChild(b);
  }

  /* sims: keep ?lang= on internal links, point "back to the site" links at /en/ */
  function langHref(href) {
    if (lang !== 'en' || !href || /^(#|mailto:|javascript:)/.test(href)) return href;
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return href;
      if (/^\/sim\//.test(u.pathname)) { u.searchParams.set('lang', 'en'); return u.pathname + u.search + u.hash; }
      if (/^\/en\//.test(u.pathname)) return href;
      var m = /^\/sada\/([^/]+)\/?$/.exec(u.pathname);
      if (m) return '/en/kit/' + m[1] + '/' + u.search + u.hash;
      m = /^\/plan\/([a-z0-9]+)\/?$/.exec(u.pathname);
      if (m) return '/en/plan/' + m[1] + '/' + u.search + u.hash;
      if (u.pathname === '/navody/so101-sestaveni/') return '/en/guides/so101-assembly/' + u.search + u.hash;
      if (u.pathname === '/' || u.pathname === '/index.html') return '/en/' + u.search + u.hash;
      if (u.pathname === '/kviz.html') return '/en/quiz/' + u.search + u.hash;
    } catch (e) {}
    return href;
  }
  function fixLinks(root) {
    if (lang !== 'en') return;
    // language links (switcher, banner) are left alone, they must point at the other language
    (root || document).querySelectorAll('a[href]:not([data-lang])').forEach(function (a) { var h = langHref(a.getAttribute('href')); if (h !== a.getAttribute('href')) a.setAttribute('href', h); });
  }

  // English pages: links rendered at runtime (app.js, sims) point at the English counterparts
  function linkFixer() {
    fixLinks();
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'attributes') { fixLinks(m.target.parentNode || m.target); return; }
        m.addedNodes.forEach(function (n) { if (n.nodeType === 1) fixLinks(n.parentNode || n); });
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  // sims: CZ / EN links that keep the current URL and only swap ?lang=
  function simSwitcher(el) {
    if (!el) return;
    var mk = function (l) { var u = new URL(location.href); u.searchParams.set('lang', l); return u.pathname + u.search + u.hash; };
    el.innerHTML = switcherHtml(lang, { cs: mk('cs'), en: mk('en') });
    if (!document.getElementById('pr-lang-css')) {
      var st = document.createElement('style'); st.id = 'pr-lang-css';
      st.textContent = '.lang-sw{display:inline-flex;align-items:center;gap:2px;font-family:var(--mono,ui-monospace,monospace);font-size:12px;color:var(--mute,#5E5E59);white-space:nowrap}' +
        '.lang-sw a,.brand .lang-sw a,.lang-sw span{display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:32px;padding:0 3px;text-decoration:none;color:inherit;font-size:12px;font-weight:400;letter-spacing:0}' +
        '.lang-sw [aria-current]{color:var(--ink,#0E0E0E);font-weight:500}.lang-sw .sep{opacity:.5;min-width:0;padding:0}';
      document.head.appendChild(st);
    }
  }

  G.PRI18N = {
    get lang() { return lang; },
    t: t, has: function (s) { return lookup(s) != null; }, addDict: addDict, observe: observe, translate: walk,
    detect: detect, setLang: setLang, remember: remember, alternates: alternates, switcherHtml: switcherHtml,
    langHref: langHref, fixLinks: fixLinks, banner: banner, simSwitcher: simSwitcher, _dicts: dicts,
    /* site pages: <script src="assets/i18n.js" data-auto> */
    initSite: function () {
      setLang(detect('site'));
      if (G.PR_I18N_EN) addDict('en', G.PR_I18N_EN);
      wireSwitcher();
      if (lang === 'en') { observe(document.documentElement); linkFixer(); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
    },
    /* sims: PRI18N.initSim(dict) before building UI; returns the language */
    initSim: function (dict) {
      setLang(detect('sim'));
      if (qsLang()) remember(qsLang());
      if (dict) addDict('en', dict);
      wireSwitcher();
      if (lang === 'en') {
        observe(document.documentElement);
        linkFixer();
      }
      return lang;
    }
  };
  if (G.document && G.document.currentScript && G.document.currentScript.hasAttribute('data-auto')) G.PRI18N.initSite();
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* printedrobotics.cz consent banner + first-party analytics. Nothing is sent and no id exists before
 * "Povolit analytiku"; DNT/GPC = declined. Docs, API and events: docs/analytics/events.md */
(function (w, d) {
  'use strict';
  // Site-wide switch. false = no banner, no footer link, no storage, no requests (calls are no-ops).
  // Turn on only together with the operator's details on /soukromi/ (docs/analytics/events.md).
  var ANALYTICS_ENABLED = false;
  if (w.prTrack) return;
  if (!ANALYTICS_ENABLED) {
    var noop = function () {};
    noop.consent = function () { return ''; }; noop.open = noop.flush = function () {};
    w.prTrack = noop; w.prTrackQ = { push: noop };
    return;
  }
  var nav = w.navigator || {}, KEY = 'pr-consent', AID = 'pr-aid', SID = 'pr-sid';
  var URL_ = w.PR_TRACK_URL || (/(^|\.)printedrobotics\.cz$/.test(location.hostname) ? 'https://api.printedrobotics.cz/e' : '');
  var dnt = nav.globalPrivacyControl === true || nav.doNotTrack === '1' || w.doNotTrack === '1';
  var q = [], pre = [], seq = 0, once = {}, timer = 0;

  function ls(k, v, s) {
    try { s = s || localStorage; if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (e) { /* blocked */ }
    return null;
  }
  function state() { var s = dnt ? 'denied' : ls(KEY); return s === 'granted' || s === 'denied' ? s : ''; }
  function en() { return /^en/.test(d.documentElement.lang); }
  function uuid() {
    if (w.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)), h = '';
    b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
    for (var i = 0; i < 16; i++) h += (b[i] + 256).toString(16).slice(1) + (i === 3 || i === 5 || i === 7 || i === 9 ? '-' : '');
    return h;
  }
  function sid() { // 30 min inactivity, per tab
    var now = Date.now(), s = (ls(SID, undefined, sessionStorage) || '').split(':');
    var id = +s[0] && now - +s[1] < 18e5 ? +s[0] : now;
    ls(SID, id + ':' + now, sessionStorage);
    return id;
  }

  function track(e, p, o) {
    try {
      var st = state(), k, props = {};
      if (!URL_ || st === 'denied') return;
      if (o && o.once) { k = e + JSON.stringify(p || {}); if (once[k]) return; once[k] = 1; }
      for (k in p) props[k] = p[k];
      props.path = location.pathname.slice(0, 120);
      props.lang = en() ? 'en' : 'cs';
      var ev = { e: e, t: Date.now(), p: props };
      if (st !== 'granted') { if (pre.length < 40) pre.push(ev); return; }
      ev.n = seq++; q.push(ev);
      if (q.length >= 20) flush(); else if (!timer) timer = setTimeout(flush, 3000);
    } catch (x) { /* never break the page */ }
  }

  function flush() {
    clearTimeout(timer); timer = 0;
    var aid = ls(AID);
    if (state() !== 'granted' || !aid) { q = []; return; }
    while (q.length) {
      var body = JSON.stringify({ v: 1, aid: aid, sid: sid(), events: q.splice(0, 25) });
      try {
        if (!(nav.sendBeacon && nav.sendBeacon(URL_, body)) && w.fetch) {
          fetch(URL_, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })['catch'](function () {});
        }
      } catch (x) { /* ignore */ }
    }
  }

  function decide(v) {
    if (dnt) v = 'denied';
    ls(KEY, v);
    if (v === 'granted') {
      if (!ls(AID)) ls(AID, uuid());
      var p = pre; pre = [];
      for (var i = 0; i < p.length; i++) { p[i].n = seq++; q.push(p[i]); }
      flush();
    } else {
      ls(AID, null); ls(SID, null, sessionStorage); q = []; pre = [];
    }
  }

  /* the banner lives in consent.js, loaded only when needed (first visit, settings link) */
  var SRC = (d.currentScript && d.currentScript.src || '').replace(/track\.js(\?.*)?$/, 'consent.js'), ui;
  function open(back) {
    if (!URL_ || !SRC) return;
    var api = { state: state, decide: decide, dnt: dnt, en: en };
    if (w.prConsentUI) return w.prConsentUI(api, back);
    if (ui) return;
    ui = d.createElement('script'); ui.src = SRC;
    ui.onload = function () { if (w.prConsentUI) w.prConsentUI(api, back); };
    d.head.appendChild(ui);
  }
  function init() {
    if (!URL_) return;
    var ft = d.querySelector('.site-f .a4s') || d.querySelector('.site-f');
    if (ft && !d.querySelector('.prc-f')) {
      ft.insertAdjacentHTML('beforeend', ' · <button type="button" class="prc-f" data-pr-consent style="background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer">' +
        (en() ? 'Privacy settings' : 'Nastavení soukromí') + '</button>');
    }
    if (!state() && !dnt) open();
  }

  /* page_view (referrer host + utm only), kit pages, marked CTAs */
  var ref = '', utm = {}, m;
  try { ref = d.referrer ? new URL(d.referrer).hostname : ''; } catch (e) { /* ignore */ }
  if (ref === location.hostname) ref = '';
  new URLSearchParams(location.search).forEach(function (v, k) {
    if (/^utm_(source|medium|campaign|content|term)$/.test(k)) utm[k] = v.toLowerCase().slice(0, 40);
  });
  if (ref) utm.ref_domain = ref;
  track('page_view', utm);
  if ((m = /^\/(?:sada|en\/kit)\/([a-z0-9_-]+)\/?$/.exec(location.pathname))) track('kit_view', { kit: m[1] });

  d.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-pr-consent],[data-cta],[data-track]');
    if (!el) return;
    if (el.hasAttribute('data-pr-consent')) { e.preventDefault(); open(el); return; }
    track('cta_click', { id: (el.getAttribute('data-cta') || el.getAttribute('data-track') || '').toLowerCase().slice(0, 40) });
  }, true);
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') flush(); });
  w.addEventListener('pagehide', flush);
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();

  track.consent = function (v) { if (v) { decide(v); if (w.prConsentUI) w.prConsentUI.close(); } return state(); };
  track.open = open;
  track.flush = flush;
  w.prTrack = track;
  // calls made before this file loaded: (window.prTrackQ = window.prTrackQ || []).push([name, props, opts])
  var early = w.prTrackQ || [];
  w.prTrackQ = { push: function (a) { track(a[0], a[1], a[2]); } };
  for (var i = 0; i < early.length; i++) w.prTrackQ.push(early[i]);
})(window, document);

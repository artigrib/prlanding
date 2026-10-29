/* printedrobotics.cz: tiny, cookie-less event beacon (NOT wired into any page yet; see docs/backend.md).
 * Sends only an allow-listed event name, e.g. {"e":"sim_start"}, to the api. No cookies, no IDs,
 * no localStorage, no URL or referrer. Silently does nothing if the api is down or blocked, and
 * honours Global Privacy Control / Do Not Track.
 * Usage:  <script src="/assets/track.js" defer></script>
 *         window.prTrack('sim_start')            // from code
 *         <a href="/sada.html" data-track="sim_cta">  // on click, declaratively
 */
(function () {
  'use strict';
  var URL = window.PR_TRACK_URL || 'https://api.printedrobotics.cz/e';
  var EVENTS = ['sim_start', 'sim_success', 'sim_cta', 'arena_start', 'arena_end', 'arena_cta',
    'mcp_connect', 'mcp_tool', 'kit_view'];
  var sent = {};
  var nav = window.navigator || {};
  var optedOut = nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1';

  function track(name, opts) {
    try {
      if (optedOut || EVENTS.indexOf(name) < 0) return;
      // once: count an event at most once per page load (e.g. sim_start)
      if (opts && opts.once) { if (sent[name]) return; sent[name] = true; }
      var body = JSON.stringify({ e: name }); // text/plain: a CORS "simple" request, no preflight
      if (nav.sendBeacon && nav.sendBeacon(URL, body)) return;
      if (window.fetch) {
        fetch(URL, { method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit',
          headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
      }
    } catch (e) { /* never break the page */ }
  }

  window.prTrack = track;
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-track]') : null;
    if (el) track(el.getAttribute('data-track'));
  }, true);
})();

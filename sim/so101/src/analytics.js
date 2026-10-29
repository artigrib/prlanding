// Funnel events for /assets/track.js (consent-gated; docs/analytics/events.md). Safe without a browser
// window (node tests) and before track.js has loaded: calls wait in window.prTrackQ.
export function track(name, props, opts) {
  try {
    if (typeof window === 'undefined') return;
    (window.prTrackQ = window.prTrackQ || []).push([name, props, opts]);
  } catch (e) { /* analytics never breaks the sim */ }
}

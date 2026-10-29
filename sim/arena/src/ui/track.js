// Funnel events for /assets/track.js (consent-gated; docs/analytics/events.md). Calls made before track.js
// has loaded wait in window.prTrackQ. Never throws.
export function track(name, props, opts) {
  try { (window.prTrackQ = window.prTrackQ || []).push([name, props, opts]); } catch (e) { /* ignore */ }
}

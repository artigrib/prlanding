// Pure helpers for the scroll-scrubbed image sequence (unit-tested in tests/seq.test.mjs).
// Load order: first, last, middle, then fill by halving gaps, so any scroll position has a near frame early.
export function loadOrder(n) {
  if (n <= 0) return [];
  const out = [0], seen = new Set([0]);
  const add = i => { if (i >= 0 && i < n && !seen.has(i)) { seen.add(i); out.push(i); } };
  add(n - 1); add((n - 1) >> 1);
  for (let step = (n - 1) / 2; step >= 1; step /= 2)
    for (let x = step / 2; x < n; x += step) add(Math.round(x));
  for (let i = 0; i < n; i++) add(i);
  return out;
}
// Scroll → thesis position u ∈ [0, centers.length-1], with a dwell at each thesis (same curve as fly.js).
export function scrollU(y, centers, reduced = false) {
  const n = centers.length, sm = x => x * x * (3 - 2 * x);
  if (!n || y <= centers[0]) return 0;
  for (let k = 0; k < n - 1; k++) if (y < centers[k + 1]) {
    const f = (y - centers[k]) / (centers[k + 1] - centers[k]);
    if (reduced) return f < .5 ? k : k + 1;
    return k + sm(Math.min(1, Math.max(0, (f - .18) / .64)));
  }
  return n - 1;
}
export const frameFor = (u, N, frames) => Math.max(0, Math.min(frames - 1, Math.round(u / N * (frames - 1))));
// nearest loaded frame to i (search outward)
export function nearest(i, have) {
  if (have[i]) return i;
  for (let d = 1; d < have.length; d++) { if (have[i - d]) return i - d; if (have[i + d]) return i + d; }
  return -1;
}

// Judges' decision at time-out, modelled on real antweight rules: three judges split
// points per category between the robots (damage weighs the most).
export const CATS = [
  { id: 'damage', name: 'Poškození', pts: 5 },
  { id: 'aggression', name: 'Agrese', pts: 3 },
  { id: 'control', name: 'Kontrola', pts: 3 }
];
// lean: who gets the odd point when a category is empty (0 = first robot, 1 = second)
function split(pts, a, b, lean = 0) {
  a = Math.max(0, a); b = Math.max(0, b);
  if (a + b < 1e-6) { const h = Math.floor(pts / 2); return lean ? [h, pts - h] : [pts - h, h]; }
  const x = Math.round(pts * a / (a + b));
  return [x, pts - x];
}
// a, b: { damage, aggression, control } raw tallies for player / opponent
export function judge(a, b, rnd = Math.random) {
  // empty categories: the odd point goes to the damage leader, then the aggression leader
  const lean = a.damage !== b.damage ? (a.damage > b.damage ? 0 : 1) : a.aggression !== b.aggression ? (a.aggression > b.aggression ? 0 : 1) : (rnd() < 0.5 ? 0 : 1);
  const cats = {}, total = [0, 0];
  for (const c of CATS) { cats[c.id] = split(c.pts, a[c.id], b[c.id], lean); total[0] += cats[c.id][0]; total[1] += cats[c.id][1]; }
  const judges = [], votes = [0, 0];
  for (let j = 0; j < 3; j++) {
    // each judge sees the fight a little differently
    const n = () => 0.82 + rnd() * 0.36;
    const s = [0, 0];
    let dmg = null;
    for (const c of CATS) {
      const p = split(c.pts, a[c.id] * n(), b[c.id] * n(), lean);
      s[0] += p[0]; s[1] += p[1];
      if (c.id === 'damage') dmg = p;
    }
    judges.push(s);
    // a judge's tie goes to the robot with more damage points
    const w = s[0] !== s[1] ? (s[0] > s[1] ? 0 : 1) : dmg[0] !== dmg[1] ? (dmg[0] > dmg[1] ? 0 : 1) : -1;
    if (w >= 0) votes[w]++;
  }
  const winner = votes[0] >= 2 ? 0 : votes[1] >= 2 ? 1 : null;
  return { cats, total, judges, votes, winner };
}

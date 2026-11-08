// English catalogue data, hand-edited part (robot translations: the "en" blocks of data/robots/<id>.json;
// tools/build.mjs merges both into assets/data.en.js). Load right after assets/data.js on /en/ pages; it overlays the Czech
// entries in place (so app.js renders English without knowing about languages) and keeps the
// Czech originals on r._cs. Only translated fields are listed; ids, licences, links, images and
// prices stay as in data.js (prices are copied, never invented). Metric units, decimal points.
window.PR_EN = {
  colors: { white: 'White', grey: 'Grey', black: 'Black', orange: 'Orange', blue: 'Blue' },
  cats: { arm: 'Arms and hands', mobile: 'Mobile', legged: 'Walking', desk: 'Desktop', combat: 'Combat robots', lab: 'Lab' },
  levels: { 'Začátečník': 'Beginner', 'Střední': 'Intermediate', 'Pokročilý': 'Advanced' },
  robots: {}, // @robots: replaced by tools/build.mjs with the "en" blocks of data/robots/*.json
  // shared values that several robots use verbatim
  values: { 'Robotická ruka': 'Robot arm', 'Rover': 'Rover', 'LeRobot (Python)': 'LeRobot (Python)', 'Python / Arduino': 'Python / Arduino', 'ROS / Python': 'ROS / Python', 'GRBL, ROS 2': 'GRBL, ROS 2', 'LeRobot, ManiSkill': 'LeRobot, ManiSkill', 'Isaac Lab, MuJoCo (Python)': 'Isaac Lab, MuJoCo (Python)', 'ROS 2 (Python), Raspberry Pi': 'ROS 2 (Python), Raspberry Pi', 'PAROL6 Commander, Python API, ROS 2 / MoveIt': 'PAROL6 Commander, Python API, ROS 2 / MoveIt' },
  sims: {
    arena: { label: 'Try it in the arena', note: 'Browser game · free · ≈ 3.5 MB' },
    so101: { label: 'Try it in the simulator', note: 'Browser simulation · free · ≈ 8.4 MB' }
  },
  // showcases (data.js PR_SHOWCASE): translated fields only; sources and licences stay as in data.js
  showcase: {}, // @showcase: replaced by tools/build.mjs with the "en" blocks of the showcase entries
  licenses: [
    ['Apache-2.0', 'y', 'Yes', 'Copy of the licence, author credit, changes marked'],
    ['MIT', 'y', 'Yes', 'Copy of the licence and the author’s copyright'],
    ['CC BY 4.0', 'y', 'Yes', 'Author credit, link to the source and licence'],
    ['CC BY-SA 4.0', 'c', 'Yes, with a condition', 'We publish modified files under the same licence'],
    ['GPL-3.0', 'c', 'Yes, with a condition', 'Source files of modified parts and firmware available'],
    ['CERN-OHL-P-2.0', 'y', 'Yes', 'Credit to the authors and the licence'],
    ['CERN-OHL-W / -S 2.0', 'c', 'Yes, with a condition', 'We publish the sources of the modified design'],
    ['CERN-OHL-1.2', 'c', 'Yes, with a condition', 'Licence copy, dated change notice, modified sources under the same licence'],
    ['CC BY-NC / custom NC', 'n', 'No', 'Only with the author’s written permission']
  ]
};

// Apply the overlay. Safe to call once; build.mjs calls it explicitly, browsers on <html lang="en"> automatically.
window.PR_EN_APPLY = function () {
  var EN = window.PR_EN, W = window;
  if (W.PR_EN_APPLIED) return; W.PR_EN_APPLIED = true;
  W.PR_COLORS.forEach(function (c) { if (EN.colors[c.id]) c.name = EN.colors[c.id]; });
  Object.keys(EN.cats).forEach(function (k) { W.PR_CATS[k] = EN.cats[k]; });
  W.PR_ROBOTS.forEach(function (r) {
    var e = EN.robots[r.id] || {}, cs = {};
    Object.keys(r).forEach(function (k) { cs[k] = r[k]; });
    r._cs = cs;
    if (EN.levels[r.level]) r.level = EN.levels[r.level];
    ['type', 'software'].forEach(function (k) { if (!e[k] && EN.values[r[k]]) r[k] = EN.values[r[k]]; });
    Object.keys(e).forEach(function (k) { r[k] = e[k]; });
  });
  (W.PR_SHOWCASE || []).forEach(function (r) {
    var e = EN.showcase[r.id]; if (!e) return;
    var cs = {}; Object.keys(r).forEach(function (k) { cs[k] = r[k]; }); r._cs = cs;
    ['type', 'level', 'badge', 'short', 'lead', 'note', 'alt', 'card', 'notAffiliated'].forEach(function (k) { if (e[k]) r[k] = e[k]; });
    r.specs = r.specs.map(function (s, i) { return [e.specLabels[i] || s[0], e.specValues[i] || s[1], s[2]]; });
    r.license = Object.assign({}, r.license, { notes: e.licenseNotes });
  });
  Object.keys(EN.sims).forEach(function (k) { if (W.PR_SIMS[k]) { W.PR_SIMS[k].label = EN.sims[k].label; W.PR_SIMS[k].note = EN.sims[k].note; } });
  W.PR_LICENSES = EN.licenses;
  // same rules as data.js, tested against the Czech originals so both languages agree
  W.PR_SAFETY = function (r) {
    var o = r._cs || r, all = JSON.stringify([o.bom || [], o.specs || [], o.lead || '']);
    var w = ['For ages 14 and up; younger children only under adult supervision. Moving parts can pinch fingers.'];
    if (/LiPo|Li-Pol|Li-ion|akumulátor|baterie/i.test(all)) w.push('Charge lithium batteries only with a suitable charger, supervised and away from flammable objects; never use a damaged cell.');
    if (/\b(24|22,2|14,8) ?V\b|\d+ ?Nm/.test(all)) w.push('Strong motors: a moving arm can cause injury. Keep your hands out of reach during bring-up and keep the power switch within reach.');
    if (/pneumatick|stlačen/i.test(all)) w.push('The pneumatic gripper runs on compressed air – use only an approved air supply and hoses.');
    if (/230 ?V|síťov/i.test(all)) w.push('A mains-powered (230 V) supply may only be wired by a qualified person.');
    if (/(^|[^a-zá-ž])magnet(?!ick)/i.test(all)) w.push('Contains small strong magnets: swallowing more than one can seriously injure the intestines. Keep away from small children. If swallowed, seek medical help immediately.');
    if (r.cat === 'combat') {
      w.push('Only power up a combat robot in an enclosed arena or with the weapon disconnected. Switch on the transmitter first, then the robot; switch off in reverse order, and check the failsafe before the first fight (the robot must stop when the transmitter is turned off).');
      if (/spinner|rotuj/i.test(all)) w.push('A spinning weapon can cause serious injury and throw debris: always lock it outside the arena and never spin it up in your hand or on a table.');
      if (/flipper/i.test(all)) w.push('The flipper moves violently: keep your fingers out of its path when handling the robot.');
    }
    if (o.liquids) w.push('Lab device: keep liquids away from the electronics and the power supply, and use chemicals and biological material only under your lab’s rules and with supervision. PLA or PETG printed parts may not withstand organic solvents. Test the device dry, without liquids, first.');
    if (o.syringe) w.push('A syringe pump builds up high pressure: if a tube clogs, the syringe or a fitting can burst and spray liquid. Set the motor driver current as the authors describe and wear safety glasses.');
    if (!o.noElectronics) w.push('Power the hardware only from the supply specified in the project instructions.');
    return w;
  };
  W.PR_SPECS = function (r) {
    return r.specs.concat([['Difficulty', r.level], ['Software', r.software], ['Parts cost (author’s estimate)', r.bomCost]])
      .filter(function (s) { return s[1] && String(s[1]).trim() !== '—'; });
  };
};
if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en') window.PR_EN_APPLY();

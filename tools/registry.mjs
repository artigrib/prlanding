// Registry ("Rejstřík") of open 3D-printable robotics projects: data/registry/projects.json (+ Czech summaries in
// data/registry/summary.cs.json). Checked and rendered by tools/build.mjs into /katalog/rejstrik/ and
// /en/catalogue/registry/; tests/registry.test.mjs runs the same check. Standalone:  node tools/registry.mjs
//
// Record (one per project): id, name, category, discipline? (optional: bio|chem|phys|agro|desk|robotics; missing = robotics),
// subcategory? (optional, kebab-case equipment/robot type, e.g. "rc-car", "centrifuge"; labels in SUBCAT_LABELS/SUBCAT_ONE),
// summary_en, homepage, repo, cad, licenses {hardware, software, docs} (exact text from the project),
// rights_class (what the HARDWARE licence lets you do with prints), printed_share, actuation, control, bom_cost,
// maturity {last_activity YYYY-MM, stars, known_builds, paper, docs_quality}, sim_model, safety_notes,
// fit {maker, school, lab, plan_guide_treatment} 1–5, sources [{url, checked}], unverified [] (internal).
// A displayed field named in `unverified` (see UNVERIFIED_RULES) renders as "neuvedeno"/"not stated", never as a fact;
// research notes removed from displayed fields live in notes [{field, text}]. Records that the source census had twice
// carry the other copy, whole, under merged_from; a changed rights_class keeps the census value in rights_class_census
// with the reason in rights_note. fork_of? names the id of the record a project is derived from (shown as a link).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CATEGORIES = ['arm', 'gripper', 'hand', 'humanoid', 'legged', 'wheeled', 'tracked', 'drone', 'actuator', 'motor', 'gearbox', 'sensor', 'lidar', 'lab-automation', 'bioreactor', 'toolchanger', 'educational', 'other'];
export const RIGHTS = ['permissive', 'copyleft', 'nc', 'nd', 'proprietary', 'unknown'];
export const PRINTED = ['high', 'medium', 'low', 'unknown'];
// field of use; a record without one counts as "robotics" (arms, legged and wheeled robots, actuators, sensors…)
export const DISCIPLINES = ['bio', 'chem', 'phys', 'agro', 'desk', 'robotics'];
export const disciplineOf = (r) => r.discipline || 'robotics';
// a hardware licence text that names no licence: such a record must not carry a licensed rights class
// ("all rights reserved" may be classed proprietary, nothing else)
export const NO_HW_LICENCE = /^(unknown|none|no |not |unclear|unspecified|tbd|n\/a|see |\?)|all rights reserved|unspecified/i;
// `unverified` entries -> displayed fields they cover (act, sim, printed, last, stars, hw, sw, docs, homepage, repo, cad;
// "all" = only name, summary and a link are shown). Entries about fields the page does not show are ignored.
export const UNVERIFIED_RULES = [
  [/^(all details|all except existence|everything except existence)/i, ['all']],
  [/^(everything except licen[cs]e|all specs)/i, ['act', 'sim', 'printed', 'last']],
  [/^(actuation|actuators\b|motor type|motor\/ratio|drive type)/i, ['act']],
  [/^(printed[ _]share|whether enclosure is 3d-printed)/i, ['printed']],
  [/^(sim|sim_model|sim model|sim details)\b/i, ['sim']],
  [/^stars\b/i, ['stars']],
  [/^(last[ _]activity|last commit|exact last release date)/i, ['last']],
  [/^licen[cs]e \(secondary/i, ['hw']],
  [/^licen[cs]es?$|^licen[cs]e \(|^licen[cs]e and price/i, ['hw', 'sw', 'docs']],
  [/^(hardware licen[cs]e(?! scope)|hardware\/mold licen[cs]e|frame licen[cs]e|cad licen[cs]e|parts licen[cs]e|tool cad licen[cs]e|bioprinter files licen[cs]e|licen[cs]e of stl files|licen[cs]e clarity)/i, ['hw']],
  [/^(software licen[cs]e|firmware licen[cs]e|horus licen[cs]e|donkeycar licen[cs]e)/i, ['sw']],
  [/^docs licen[cs]e/i, ['docs']],
  [/^homepage$/i, ['homepage']], [/^repo$/i, ['repo']], [/^(cad link|cad repo location|onshape url)/i, ['cad']]
];
export function hiddenFields(r) {
  const out = new Set();
  for (const u of r.unverified || []) for (const [re, f] of UNVERIFIED_RULES) if (re.test(u)) { f.forEach((x) => out.add(x)); break; }
  return out;
}
// SPDX-ish normalisation for comparing with the catalogue ("CC BY-SA 4.0" = "CC-BY-SA-4.0", "GPL-3.0" = "GPL-3.0-only")
export const normLicence = (s) => String(s || '').replace(/\s*\(.*$/, '').replace(/;.*$/, '').trim().toUpperCase().replace(/\s+/g, '-').replace(/-(ONLY|OR-LATER)$/, '');
// registry id -> curated catalogue entry (assets/data.js PR_ROBOTS id, or a PR_SHOWCASE id)
export const CATALOGUE = {
  'so-arm100-101': 'so101', lekiwi: 'lekiwi', xlerobot: 'xle', 'open-duck-mini': 'duck', 'amazing-hand': 'hand', 'otto-diy': 'otto',
  spotmicro: 'spot', 'sawppy-rover': 'sawppy', thor: 'thor', exomy: 'exomy', 'so-arm102': 'so102', 'nextis-aira': 'aira',
  parol6: 'parol6', 'berkeley-humanoid-lite': 'bhl', 'roboto-origin': 'origin',
  'open-128-rc-car': 'rc128', zcar2: 'zcar2', 'lizard-rc-race-car': 'lizard',
  'stack-chan': 'stackchan', 'openflexure-microscope': 'openflexure'
};
const SHOWCASE_PATH = { origin: { cs: 'sim/origin/', en: 'en/sim/origin/' } };

export const LABELS = {
  cs: {
    cat: { arm: 'Robotická ruka', gripper: 'Chapadlo', hand: 'Robotická dlaň', humanoid: 'Humanoid', legged: 'Kráčející robot', wheeled: 'Robot na kolech', tracked: 'Pásový robot', drone: 'Dron', actuator: 'Pohon', motor: 'Motor', gearbox: 'Převodovka', sensor: 'Senzor', lidar: 'Lidar', 'lab-automation': 'Laboratorní automatizace', bioreactor: 'Bioreaktor', toolchanger: 'Výměna nástrojů', educational: 'Výukový robot', other: 'Ostatní' },
    rights: { permissive: 'Volná licence', copyleft: 'Copyleft', nc: 'Jen nekomerčně', nd: 'Bez úprav', proprietary: 'Uzavřená', unknown: 'Licence neověřena' },
    printed: { high: 'vysoký', medium: 'střední', low: 'nízký', unknown: 'neuvedeno' },
    sim: { none: 'žádný', 'none known': 'žádný známý', unknown: 'neuvedeno', 'n/a': '—' },
    hw: 'Hardware', sw: 'Software', docs: 'Dokumentace', act: 'Pohon', simL: 'Simulační model', printedL: 'Podíl tisku', last: 'Poslední aktivita', stars: 'hvězd na GitHubu',
    fit: 'Vhodnost', maker: 'maker', school: 'škola', web: 'Web', repo: 'Repozitář', cad: 'CAD', paper: 'Článek', zenodo: 'Zenodo', inCat: 'Karta v katalogu', inShow: 'Ukázka v simulaci', of5: 'z 5',
    na: 'neuvedeno', naLic: 'neuvedena', thin: 'Údaje neověřeny', src: 'Zdroj', forkOf: 'Odvozeno z projektu',
    disc: { bio: 'Biologie', chem: 'Chemie', phys: 'Fyzika', agro: 'Zemědělství', desk: 'Stůl', robotics: 'Robotika' }
  },
  en: {
    cat: { arm: 'Robot arm', gripper: 'Gripper', hand: 'Robot hand', humanoid: 'Humanoid', legged: 'Legged robot', wheeled: 'Wheeled robot', tracked: 'Tracked robot', drone: 'Drone', actuator: 'Actuator', motor: 'Motor', gearbox: 'Gearbox', sensor: 'Sensor', lidar: 'Lidar', 'lab-automation': 'Lab automation', bioreactor: 'Bioreactor', toolchanger: 'Tool changer', educational: 'Educational robot', other: 'Other' },
    rights: { permissive: 'Permissive', copyleft: 'Copyleft', nc: 'Non-commercial only', nd: 'No modifications', proprietary: 'Closed', unknown: 'Licence not confirmed' },
    printed: { high: 'high', medium: 'medium', low: 'low', unknown: 'not stated' },
    sim: { none: 'none', 'none known': 'none known', unknown: 'not stated', 'n/a': '—' },
    hw: 'Hardware', sw: 'Software', docs: 'Docs', act: 'Actuation', simL: 'Sim model', printedL: 'Printed share', last: 'Last activity', stars: 'GitHub stars',
    fit: 'Fit', maker: 'maker', school: 'school', web: 'Website', repo: 'Repository', cad: 'CAD', paper: 'Paper', zenodo: 'Zenodo', inCat: 'Catalogue card', inShow: 'Showcase in the simulator', of5: 'of 5',
    na: 'not stated', naLic: 'not stated', thin: 'Details unconfirmed', src: 'Source', forkOf: 'Derived from',
    disc: { bio: 'Biology', chem: 'Chemistry', phys: 'Physics', agro: 'Agriculture', desk: 'Desktop', robotics: 'Robotics' }
  }
};
// subcategory labels (optional field), one row per slug: [cs plural (filter), cs singular (entry), en plural, en singular].
// Every slug used in projects.json must have a row (checked by tests/registry.test.mjs); an unlisted value would be
// shown as written, hyphens as spaces.
export const SUBCATS = {
  // robotics (RC cars under "wheeled")
  'rc-car': ['RC auta', 'RC auto', 'RC cars', 'RC car'],
  'rc-truck-crawler': ['Crawlery', 'RC crawler / truck', 'Crawlers', 'RC crawler / truck'],
  'rc-tank': ['Tanky', 'RC tank', 'Tanks', 'RC tank'],
  'autonomous-car-platform': ['Autonomní platformy', 'Autonomní platforma', 'Autonomous platforms', 'Autonomous platform'],
  // biology
  bioprinter: ['Biotiskárny', 'Biotiskárna', 'Bioprinters', 'Bioprinter'],
  centrifuge: ['Centrifugy', 'Centrifuga', 'Centrifuges', 'Centrifuge'],
  electroporator: ['Elektroporátory', 'Elektroporátor', 'Electroporators', 'Electroporator'],
  'gel-electrophoresis': ['Gelová elektroforéza', 'Gelová elektroforéza', 'Gel electrophoresis', 'Gel electrophoresis'],
  isothermal: ['Izotermální amplifikace (LAMP)', 'Izotermální amplifikace (LAMP)', 'Isothermal amplification (LAMP)', 'Isothermal amplification (LAMP)'],
  micropipette: ['Mikropipety', 'Mikropipeta', 'Micropipettes', 'Micropipette'],
  microscope: ['Mikroskopy', 'Mikroskop', 'Microscopes', 'Microscope'],
  pcr: ['PCR cyklery', 'PCR cykler', 'PCR thermocyclers', 'PCR thermocycler'],
  'peristaltic-pump': ['Peristaltická čerpadla', 'Peristaltické čerpadlo', 'Peristaltic pumps', 'Peristaltic pump'],
  'pipette-controller': ['Elektronické pipetory', 'Elektronický pipetor', 'Pipette controllers', 'Pipette controller'],
  qpcr: ['qPCR cyklery', 'qPCR cykler', 'qPCR instruments', 'qPCR instrument'],
  'rocker-incubator': ['Kolébkové inkubátory', 'Kolébkový inkubátor', 'Rocking incubators', 'Rocking incubator'],
  'rotator-shaker': ['Rotátory a třepačky', 'Rotátor / třepačka', 'Rotators and shakers', 'Rotator / shaker'],
  spectrophotometer: ['Spektrofotometry', 'Spektrofotometr', 'Spectrophotometers', 'Spectrophotometer'],
  'syringe-pump': ['Stříkačková čerpadla', 'Stříkačkové čerpadlo', 'Syringe pumps', 'Syringe pump'],
  'vortex-mixer': ['Vortexy', 'Vortex', 'Vortex mixers', 'Vortex mixer'],
  // chemistry
  autosampler: ['Autosamplery', 'Autosampler', 'Autosamplers', 'Autosampler'],
  balance: ['Váhy', 'Laboratorní váha', 'Balances', 'Balance'],
  colorimeter: ['Kolorimetry', 'Kolorimetr', 'Colorimeters', 'Colorimeter'],
  'contact-angle-goniometer': ['Měření kontaktního úhlu', 'Goniometr kontaktního úhlu', 'Contact-angle goniometers', 'Contact-angle goniometer'],
  'electrochemistry-cell': ['Elektrochemické cely', 'Elektrochemická cela', 'Electrochemical cells', 'Electrochemical cell'],
  'flow-chemistry-reactor': ['Průtokové reaktory', 'Průtokový reaktor', 'Flow-chemistry reactors', 'Flow-chemistry reactor'],
  fluorimeter: ['Fluorimetry', 'Fluorimetr', 'Fluorimeters', 'Fluorimeter'],
  'fraction-collector': ['Sběrače frakcí', 'Sběrač frakcí', 'Fraction collectors', 'Fraction collector'],
  'fume-extraction': ['Odsávání výparů', 'Odsávačka výparů', 'Fume extraction', 'Fume extractor'],
  'glove-box': ['Rukavicové boxy', 'Rukavicový box', 'Glove boxes', 'Glove box'],
  'magnetic-stirrer': ['Magnetická míchadla', 'Magnetické míchadlo', 'Magnetic stirrers', 'Magnetic stirrer'],
  'orbital-shaker': ['Orbitální třepačky', 'Orbitální třepačka', 'Orbital shakers', 'Orbital shaker'],
  'robotic-chemist': ['Samořízené laboratoře', 'Samořízená laboratoř', 'Self-driving labs', 'Self-driving lab'],
  'sample-rack': ['Stojany na zkumavky', 'Stojan na zkumavky', 'Sample racks', 'Sample rack'],
  'spin-coater': ['Rotační nanášečky', 'Rotační nanášečka (spin coater)', 'Spin coaters', 'Spin coater'],
  titrator: ['Titrátory', 'Titrátor', 'Titrators', 'Titrator'],
  'tlc-tools': ['Pomůcky pro TLC', 'Pomůcka pro TLC', 'TLC tools', 'TLC tool'],
  turbidimeter: ['Turbidimetry', 'Turbidimetr', 'Turbidimeters', 'Turbidimeter'],
  'uv-vis-spectrophotometer': ['Spektrofotometry UV-Vis', 'Spektrofotometr UV-Vis', 'UV-Vis spectrophotometers', 'UV-Vis spectrophotometer'],
  'viscometer-rheometer': ['Viskozimetry a reometry', 'Viskozimetr / reometr', 'Viscometers and rheometers', 'Viscometer / rheometer'],
  // physics
  'antenna-rotator': ['Rotátory antén', 'Rotátor antény', 'Antenna rotators', 'Antenna rotator'],
  'cubesat-structure': ['Konstrukce CubeSatů', 'Konstrukce CubeSatu', 'CubeSat structures', 'CubeSat structure'],
  'geiger-counter': ['Geigerovy počítače', 'Geigerův počítač', 'Geiger counters', 'Geiger counter'],
  interferometer: ['Interferometry', 'Interferometr', 'Interferometers', 'Interferometer'],
  'inverted-pendulum': ['Inverzní kyvadla', 'Inverzní kyvadlo', 'Inverted pendulums', 'Inverted pendulum'],
  'magnetism-helmholtz-coil': ['Helmholtzovy cívky', 'Helmholtzova cívka', 'Helmholtz coils', 'Helmholtz coil'],
  'microscope-positioning-stage': ['Polohovací stolky', 'Polohovací stolek mikroskopu', 'Positioning stages', 'Microscope positioning stage'],
  'modular-optics': ['Modulární optika', 'Modulární optická stavebnice', 'Modular optics', 'Modular optics kit'],
  'optical-tweezers': ['Optické pinzety', 'Optická pinzeta', 'Optical tweezers', 'Optical tweezers'],
  optomechanics: ['Optomechanika', 'Optomechanika', 'Optomechanics', 'Optomechanics'],
  'photogate-timer': ['Optické závory', 'Optická závora a časomíra', 'Photogates', 'Photogate timer'],
  'quantum-sensing-odmr': ['Kvantové senzory (ODMR)', 'Kvantový senzor (ODMR)', 'Quantum sensing (ODMR)', 'Quantum sensing (ODMR)'],
  'raman-spectrometer': ['Ramanovy spektrometry', 'Ramanův spektrometr', 'Raman spectrometers', 'Raman spectrometer'],
  seismometer: ['Seismometry', 'Seismometr', 'Seismometers', 'Seismometer'],
  spectrometer: ['Spektrometry', 'Spektrometr', 'Spectrometers', 'Spectrometer'],
  'stirling-engine': ['Stirlingovy motory', 'Stirlingův motor', 'Stirling engines', 'Stirling engine'],
  telescope: ['Dalekohledy', 'Dalekohled', 'Telescopes', 'Telescope'],
  'telescope-accessory': ['Příslušenství dalekohledů', 'Příslušenství dalekohledu', 'Telescope accessories', 'Telescope accessory'],
  'telescope-mount': ['Montáže dalekohledů', 'Montáž dalekohledu', 'Telescope mounts', 'Telescope mount'],
  'weather-station': ['Meteostanice', 'Meteostanice', 'Weather stations', 'Weather station'],
  'wind-tunnel': ['Aerodynamické tunely', 'Aerodynamický tunel', 'Wind tunnels', 'Wind tunnel'],
  // agriculture
  'cnc-garden-robot': ['Zahradní CNC roboti', 'Zahradní CNC robot', 'CNC garden robots', 'CNC garden robot'],
  'fertigation-controller': ['Zálivka a hnojení', 'Automat na zálivku a hnojení', 'Fertigation controllers', 'Fertigation controller'],
  'hydroponics-tower': ['Hydroponické věže', 'Hydroponická věž', 'Hydroponic towers', 'Hydroponic tower'],
  'nutrient-dosing-pump': ['Dávkování živin', 'Dávkovací čerpadlo živin', 'Nutrient dosing pumps', 'Nutrient dosing pump'],
  'plant-growth-chamber': ['Pěstební komory', 'Pěstební komora', 'Plant growth chambers', 'Plant growth chamber'],
  'plant-phenotyping-gantry': ['Fenotypizační dráhy', 'Fenotypizační robot na dráze', 'Phenotyping gantries', 'Plant-phenotyping gantry'],
  'plant-phenotyping-imager': ['Snímání rostlin', 'Snímač pro fenotypizaci rostlin', 'Plant imagers', 'Plant-phenotyping imager'],
  'poultry-coop-door': ['Dvířka kurníku', 'Automatická dvířka kurníku', 'Coop doors', 'Poultry coop door'],
  'robot-mower': ['Robotické sekačky', 'Robotická sekačka', 'Robot mowers', 'Robot mower'],
  'root-phenotyping-imager': ['Snímání kořenů', 'Snímač kořenů', 'Root imagers', 'Root-phenotyping imager'],
  'weeding-spot-sprayer': ['Bodový postřik plevele', 'Bodový postřikovač plevele', 'Weed spot sprayers', 'Weed spot sprayer'],
  // desktop
  'ball-balancing-platform': ['Balancování míčku', 'Plošina balancující míček', 'Ball balancers', 'Ball-balancing platform'],
  'camera-slider': ['Kamerové jezdce', 'Kamerový jezdec', 'Camera sliders', 'Camera slider'],
  'chess-robot': ['Šachoví roboti', 'Šachový robot', 'Chess robots', 'Chess robot'],
  'cocktail-machine': ['Míchače nápojů', 'Míchač nápojů', 'Drink machines', 'Drink-mixing machine'],
  'delta-robot': ['Delta roboti', 'Delta robot', 'Delta robots', 'Delta robot'],
  'desk-cleaning-robot': ['Úklidoví roboti na stůl', 'Úklidový robot na stůl', 'Desk-cleaning robots', 'Desk-cleaning robot'],
  'desk-quadruped': ['Malí čtyřnožci', 'Malý čtyřnohý robot', 'Small quadrupeds', 'Small quadruped'],
  'desktop-cnc': ['Stolní CNC', 'Stolní CNC', 'Desktop CNC', 'Desktop CNC'],
  'desktop-companion': ['Roboti-společníci', 'Stolní robot-společník', 'Companion robots', 'Desktop companion robot'],
  'desktop-conveyor': ['Stolní dopravníky', 'Stolní dopravník', 'Desktop conveyors', 'Desktop conveyor'],
  'desktop-humanoid': ['Stolní humanoidi', 'Stolní humanoid', 'Desktop humanoids', 'Desktop humanoid'],
  'desktop-robot-arm': ['Stolní robotické ruce', 'Stolní robotická ruka', 'Desktop robot arms', 'Desktop robot arm'],
  'desktop-sorter': ['Třídičky', 'Stolní třídička', 'Desktop sorters', 'Desktop sorter'],
  'drawing-arm': ['Kreslicí ramena', 'Kreslicí rameno', 'Drawing arms', 'Drawing arm'],
  'educational-desktop-robot': ['Výukoví roboti', 'Výukový robot', 'Educational robots', 'Educational desktop robot'],
  'kinetic-sand-table': ['Kinetické pískové stoly', 'Kinetický pískový stůl', 'Kinetic sand tables', 'Kinetic sand table'],
  'laser-engraver': ['Laserové gravírky', 'Laserová gravírka', 'Laser engravers', 'Laser engraver'],
  'pen-plotter': ['Kreslicí plottery', 'Kreslicí plotter', 'Pen plotters', 'Pen plotter'],
  'pick-and-place': ['Osazovací automaty', 'Osazovací automat', 'Pick-and-place machines', 'Pick-and-place machine'],
  'robotic-chess-board': ['Samohybné šachovnice', 'Samohybná šachovnice', 'Self-moving chess boards', 'Self-moving chess board'],
  'robotic-lamp': ['Robotické lampy', 'Robotická lampa', 'Robotic lamps', 'Robotic lamp'],
  'rubiks-cube-solver': ['Řešiče Rubikovy kostky', 'Řešič Rubikovy kostky', "Rubik's cube solvers", "Rubik's cube solver"],
  'scara-arm': ['Ramena SCARA', 'Rameno SCARA', 'SCARA arms', 'SCARA arm'],
  'sphere-plotter': ['Plottery na vejce a koule', 'Plotter na vejce a koule', 'Egg and sphere plotters', 'Egg / sphere plotter'],
  'telepresence-robot': ['Teleprezenční roboti', 'Teleprezenční robot', 'Telepresence robots', 'Telepresence robot']
};
const subcatCol = (i) => Object.fromEntries(Object.entries(SUBCATS).map(([k, v]) => [k, v[i]]));
export const SUBCAT_LABELS = { cs: subcatCol(0), en: subcatCol(2) };
export const SUBCAT_ONE = { cs: subcatCol(1), en: subcatCol(3) };

// "Bílá místa" / "Gaps": per discipline, standard equipment types for which the six census batches (2026-11-01) found
// no open, substantially printed design. Types as the research notes name them (data/registry has the batches' summaries).
export const GAPS = {
  bio: {
    cs: ['topný blok / suchá lázeň', 'vodní lázeň', 'inkubátor (jako samostatný přístroj)', 'CO2 inkubátor', 'laminární box', 'sterilizátory / autoklávy', 'mikromanipulátor', 'počítač kolonií (hardware)', 'čtečka mikrodestiček', 'transiluminátor / zobrazování gelů', 'manipulace s mikrodestičkami'],
    en: ['heat block / dry bath', 'water bath', 'incubator (as a standalone device)', 'CO2 incubator', 'laminar flow / clean bench', 'sterilisers / autoclaves', 'micromanipulator', 'colony counter (hardware)', 'plate reader', 'transilluminator / gel imager', 'plate handler / microplate tools']
  },
  chem: {
    cs: ['míchací topná plotýnka', 'nástavcové (horní) míchadlo', 'pH metr', 'konduktometr', 'přístroj na stanovení bodu tání', 'termostatovaná lázeň', 'laboratorní stojany, svorky a držáky', 'elektrospinning'],
    en: ['stirring hotplate', 'overhead stirrer', 'pH meter', 'conductivity meter', 'melting point apparatus', 'thermostatted bath', 'lab stands / clamps / holders', 'electrospinning']
  },
  phys: {
    cs: ['polarimetr', 'lineární / posuvné stolky', 'vzduchová dráha', 'vozíky pro dynamiku / nakloněná rovina', 'vlnová vana', 'zvuk / Kundtova trubice / rezonance', 'mlžná komora', 'elektrostatika (Van de Graaffův generátor, Wimshurstova elektrika)', 'ochranné kryty pro lasery', 'díly vakuové komory'],
    en: ['polarimeter', 'linear / translation stages', 'air track', 'dynamics carts / inclined plane', 'ripple tank / waves', 'sound / Kundt tube / resonance', 'cloud chamber', 'electrostatics (Van de Graaff, Wimshurst)', 'laser safety enclosures', 'vacuum chamber parts']
  },
  agro: {
    cs: ['polní robotická platforma / rover pro řádkové plodiny', 'mechanický odplevelovací robot', 'laserové odplevelování', 'sklízecí robot / chapadlo na ovoce', 'odběr vzorků půdy / sondy', 'krmení hospodářských zvířat / přihrnování krmiva', 'sledování hospodářských zvířat (obojky apod.)', 'opylovací roboti', 'zemědělské drony (tištěné rámy)', 'sledování úlů / počítadla včel', 'sledování hmyzu a škůdců', 'komory pro plodnice hub', 'chov hmyzu (potemník moučný, bráněnka)', 'počítání a třídění semen', 'otevřené traktory', 'gravitropismus rostlin / klinostaty'],
    en: ['field robot platform / row-crop rover', 'weeding robot, mechanical', 'weeding, laser', 'harvesting robot / fruit gripper', 'soil sampling / probes', 'livestock: feeding / feed pushers', 'livestock monitoring (collars, etc.)', 'pollination robots', 'agricultural drones (printed frames)', 'beehive monitoring / bee counters', 'insect / pest monitoring', 'mushroom fruiting chambers', 'insect farming (mealworms, black soldier fly)', 'seed counting / sorting', 'open tractors', 'plant gravitropism / clinostats']
  },
  desk: {
    cs: ['polargraf / svislý plotter', 'roboti na air hockey a jiné hry', 'stolní robotická ruka s dopravníkem (pracoviště typu Dobot)'],
    en: ['polargraph / vertical plotter', 'air-hockey / game robots', 'desktop robot arm with conveyor (Dobot-like workcell)']
  }
};
// hazard line per record: tags derived from the equipment type and the record's safety_notes (not from fit scores)
export const HAZARDS = {
  hv: { sub: ['gel-electrophoresis', 'electroporator'], re: /high[- ]voltage|\d\s?kV\b/i },
  laser: { sub: [], re: /\blaser(?![- ]?cut)/i, not: /no laser|laser safety depends on/i },
  mains: { sub: [], re: /mains[- ](powered )?heater/i },
  rotor: { sub: ['centrifuge', 'spin-coater'], re: /high-speed rotor|spinning rotor/i },
  radiation: { sub: [], re: /radiation|radioactive|check sources?/i },
  gas: { sub: [], re: /compressed (inert )?gas|gas cylinder|pressuri[sz]ed gas/i }
};
export const HAZARD_LABELS = {
  cs: { hv: 'vysoké napětí', laser: 'laser', mains: 'ohřev napájený ze sítě', rotor: 'rychle se otáčející rotor', radiation: 'zdroj záření', gas: 'stlačený plyn', pre: 'Pozor: ', post: ' — jen pod dohledem dospělého.' },
  en: { hv: 'high voltage', laser: 'laser', mains: 'mains-powered heater', rotor: 'fast-spinning rotor', radiation: 'radiation source', gas: 'pressurised gas', pre: 'Caution: ', post: ' — adult supervision only.' }
};
export function hazardsOf(r) {
  const s = r.safety_notes || '';
  return Object.entries(HAZARDS).filter(([, h]) => h.sub.includes(r.subcategory) || (h.re.test(s) && !(h.not && h.not.test(s)))).map(([k]) => k);
}
export function renderGaps(L) {
  const T = LABELS[L];
  return '<dl class="doc-lic reg-gaps">' + Object.entries(GAPS).map(([d, g]) => `<div><dt>${esc(T.disc[d])}</dt><dd>${esc(g[L].join(', '))}</dd></div>`).join('') + '</dl>';
}

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u);
export function loadRegistry(root = '.') {
  const p = (f) => `${root}/data/registry/${f}`;
  return { records: JSON.parse(fs.readFileSync(p('projects.json'), 'utf8')), cs: JSON.parse(fs.readFileSync(p('summary.cs.json'), 'utf8')) };
}

// returns a list of problems (empty = ok); catalogue = {catalogue id: hardware licence} of the curated catalogue
// (assets/data.js PR_ROBOTS/PR_SHOWCASE, license.hw or hw), optional
export function checkRegistry(records, cs = {}, catalogue = null) {
  const errors = [], seen = new Set();
  if (!Array.isArray(records) || !records.length) return ['projects.json: expected a non-empty array'];
  for (const [i, r] of records.entries()) {
    const at = `#${i} ${r && r.id || '?'}`;
    if (!r || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) { errors.push(`${at}: id must be kebab-case`); continue; }
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!r.name || typeof r.name !== 'string') errors.push(`${at}: missing name`);
    if (!CATEGORIES.includes(r.category)) errors.push(`${at}: category "${r.category}" not in ${CATEGORIES.join('|')}`);
    if ('subcategory' in r && !(typeof r.subcategory === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(r.subcategory))) errors.push(`${at}: subcategory must be a kebab-case string when present`);
    if ('discipline' in r && !DISCIPLINES.includes(r.discipline)) errors.push(`${at}: discipline "${r.discipline}" not in ${DISCIPLINES.join('|')}`);
    if (r.merged_from != null && !(Array.isArray(r.merged_from) && r.merged_from.every((m) => m && typeof m === 'object' && typeof m.id === 'string'))) errors.push(`${at}: merged_from must be a list of the merged census records`);
    if (!RIGHTS.includes(r.rights_class)) errors.push(`${at}: rights_class "${r.rights_class}" not in ${RIGHTS.join('|')}`);
    if (!PRINTED.includes(r.printed_share)) errors.push(`${at}: printed_share "${r.printed_share}" not in ${PRINTED.join('|')}`);
    if (!r.summary_en || typeof r.summary_en !== 'string') errors.push(`${at}: missing summary_en`);
    if (!cs[r.id]) errors.push(`${at}: missing Czech summary in data/registry/summary.cs.json`);
    const urls = (Array.isArray(r.sources) ? r.sources : []).map((s) => s && s.url).filter(isUrl);
    if (!urls.length) errors.push(`${at}: needs at least one source URL`);
    for (const k of ['homepage', 'repo']) if (r[k] != null && !isUrl(r[k])) errors.push(`${at}: ${k} is not a URL`);
    if (r.cad != null && (typeof r.cad !== 'string' || !r.cad.trim())) errors.push(`${at}: cad must be a URL, a short text or null`);
    const hw = r.licenses && r.licenses.hardware;
    if (typeof hw !== 'string' || !hw.trim()) errors.push(`${at}: licenses.hardware must be the licence text (or "unknown")`);
    // never shown as licensed without an established hardware licence
    else if (r.rights_class !== 'unknown' && NO_HW_LICENCE.test(hw) && !(r.rights_class === 'proprietary' && /all rights reserved/i.test(hw))) errors.push(`${at}: rights_class "${r.rights_class}" but the hardware licence is "${hw}" – use "unknown"`);
    if (r.rights_class !== 'unknown' && hiddenFields(r).has('hw')) errors.push(`${at}: rights_class "${r.rights_class}" but the hardware licence is listed as unverified – use "unknown"`);
    if (r.notes != null && !(Array.isArray(r.notes) && r.notes.every((n) => n && typeof n.field === 'string' && typeof n.text === 'string'))) errors.push(`${at}: notes must be [{field, text}]`);
    // YYYY-MM preferred; a year with a note ("2022", "2020 (last paper)") or "unknown" is kept as written
    if (!r.maturity || !(r.maturity.last_activity == null || r.maturity.last_activity === 'unknown' || /^\d{4}(-\d{2})?\b/.test(r.maturity.last_activity))) errors.push(`${at}: maturity.last_activity must start with YYYY or YYYY-MM (or be null/"unknown")`);
    if (r.maturity && r.maturity.stars != null && !Number.isInteger(r.maturity.stars)) errors.push(`${at}: maturity.stars must be an integer or null`);
    for (const k of ['maker', 'school']) { const v = r.fit && r.fit[k]; if (!(Number.isInteger(v) && v >= 1 && v <= 5)) errors.push(`${at}: fit.${k} must be 1–5`); }
  }
  for (const id of Object.keys(cs)) if (!seen.has(id)) errors.push(`summary.cs.json: "${id}" has no record`);
  // derived designs link their original; a merged-away census id must not come back as a record of its own
  const merged = new Set(records.flatMap((r) => (r && Array.isArray(r.merged_from) ? r.merged_from : []).map((m) => m.id).filter((id) => id !== r.id)));
  for (const r of records) {
    if (!r || r.fork_of == null) continue;
    if (typeof r.fork_of !== 'string' || !seen.has(r.fork_of) || r.fork_of === r.id) errors.push(`${r.id}: fork_of "${r.fork_of}" is not another record's id`);
  }
  for (const id of merged) if (seen.has(id)) errors.push(`${id}: merged into another record (merged_from) but still listed on its own`);
  for (const [rid, cid] of Object.entries(CATALOGUE)) {
    if (!seen.has(rid)) errors.push(`CATALOGUE: registry id "${rid}" has no record`);
    if (!catalogue) continue;
    if (!(cid in catalogue)) { errors.push(`CATALOGUE: "${cid}" is not in the curated catalogue`); continue; }
    const rec = records.find((r) => r && r.id === rid);
    if (!rec) continue;
    // the registry and the catalogue card must agree on the hardware licence; a catalogue licence without a version
    // ("CC BY (Thingiverse)") is not definite, so the registry must not class it either
    const c = Array.isArray(catalogue[cid]) ? null : normLicence(catalogue[cid]), g = normLicence(rec.licenses && rec.licenses.hardware);
    if (!c || !(/\d/.test(c) || /^(MIT|ISC|UNLICENSE|0BSD)$/.test(c))) { if (rec.rights_class !== 'unknown') errors.push(`CATALOGUE: ${rid} is classed "${rec.rights_class}" but the catalogue licence "${catalogue[cid]}" is not definite`); }
    else if (c !== g) errors.push(`CATALOGUE: ${rid} hardware licence "${rec.licenses.hardware}" ≠ catalogue ${cid} "${catalogue[cid]}"`);
  }
  return errors;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MK = { permissive: 'y', copyleft: 'c', nc: 'n', nd: 'n', proprietary: 'n', unknown: 'u' };
// default order (the page's "fit" sort): maker fit, then school fit, then last activity, then name
export const lastKey = (r) => (/^\d{4}(-\d{2})?/.exec(r.maturity.last_activity || '') || [''])[0];
export function sortRecords(records) {
  return [...records].sort((a, b) => (b.fit.maker - a.fit.maker) || (b.fit.school - a.fit.school)
    || lastKey(b).localeCompare(lastKey(a)) || a.name.localeCompare(b.name, 'en'));
}
export const subcatLabel = (L, s, one) => (one ? SUBCAT_ONE : SUBCAT_LABELS)[L][s] || s.replace(/-/g, ' ');
// links to articles rather than project pages are labelled "Článek" / "Paper" (a Zenodo DOI is labelled "Zenodo")
const PAPER = /biorxiv\.org|ncbi\.nlm\.nih\.gov\/pmc|research\.wur\.nl\/en\/publications|doi\.org\/10\.(?!5281\/)|journals\.plos\.org\/[a-z]+\/article\?id=|mdpi\.com\/\d|doaj\.org\/article|hardware-x\.com\/article|digitalcommons\.mtu\.edu|research\.chalmers\.se\/en\/publication|\/journal_contribution\//i;

// static list + filter form; root = path to the site root from the page
export function renderRegistry(L, records, cs, root) {
  const T = LABELS[L], en = L === 'en', lang = en ? '' : ' lang="en"';
  const count = (k, v) => records.filter((r) => r[k] === v).length;
  const opt = (v, t, n) => `<option value="${v}">${esc(t)}${n == null ? '' : ` (${n})`}</option>`;
  const cats = CATEGORIES.filter((c) => count('category', c));
  const discs = DISCIPLINES.filter((d) => records.some((r) => disciplineOf(r) === d));
  const subOpts = (sel, val) => [...new Set(records.filter(sel).filter((r) => r.subcategory).map((r) => r.subcategory))]
    .sort((a, b) => subcatLabel(L, a).localeCompare(subcatLabel(L, b), L))
    .map((sc) => `<option value="${val}/${esc(sc)}">\u00a0\u00a0· ${esc(subcatLabel(L, sc))} (${records.filter(sel).filter((r) => r.subcategory === sc).length})</option>`).join('');
  const F = en
    ? { legend: 'Filter the registry', disc: 'Field', cat: 'Category', all: 'All', rights: 'Rights', printed: 'Printed share', fitL: 'Good fit for', any: 'Anyone', fm: 'Makers (4–5 of 5)', fs: 'Schools (4–5 of 5)', q: 'Search', qph: 'name, motor, licence…', sort: 'Sort', sFit: 'Fit (maker, school)', sSchool: 'Fit for schools', sLast: 'Last activity', sName: 'Name', reset: 'Clear filters', msg: 'Showing {n} of {total} projects', none: 'No project matches these filters.' }
    : { legend: 'Filtr rejstříku', disc: 'Obor', cat: 'Kategorie', all: 'Vše', rights: 'Práva', printed: 'Podíl tisku', fitL: 'Vhodné pro', any: 'Kohokoli', fm: 'Makery (4–5 z 5)', fs: 'Školy (4–5 z 5)', q: 'Hledat', qph: 'název, motor, licence…', sort: 'Řazení', sFit: 'Vhodnost (maker, škola)', sSchool: 'Vhodnost pro školy', sLast: 'Poslední aktivita', sName: 'Název', reset: 'Zrušit filtry', msg: 'Zobrazeno {n} z {total} projektů', none: 'Filtrům neodpovídá žádný projekt.' };
  const form = `<form class="reg-f" id="reg-f" hidden data-msg="${esc(F.msg)}" aria-label="${esc(F.legend)}">
<label class="reg-q"><span>${F.q}</span><input type="search" name="q" placeholder="${esc(F.qph)}" autocomplete="off"></label>
<label><span>${F.disc}</span><select name="disc">${opt('', F.all, records.length)}${discs.map((d) => opt(d, T.disc[d], records.filter((r) => disciplineOf(r) === d).length)
  + subOpts((r) => disciplineOf(r) === d && d !== 'robotics', d)).join('')}</select></label>
<label><span>${F.cat}</span><select name="cat">${opt('', F.all, records.length)}${cats.map((c) => opt(c, T.cat[c], count('category', c))
  + subOpts((r) => r.category === c && disciplineOf(r) === 'robotics', c)).join('')}</select></label>
<label><span>${F.rights}</span><select name="rights">${opt('', F.all)}${RIGHTS.map((c) => opt(c, T.rights[c], count('rights_class', c))).join('')}</select></label>
<label><span>${F.printed}</span><select name="printed">${opt('', F.all)}${PRINTED.map((c) => opt(c, T.printed[c], count('printed_share', c))).join('')}</select></label>
<label><span>${F.fitL}</span><select name="fit">${opt('', F.any)}${opt('maker', F.fm)}${opt('school', F.fs)}</select></label>
<label><span>${F.sort}</span><select name="sort">${opt('fit', F.sFit)}${opt('school', F.sSchool)}${opt('last', F.sLast)}${opt('name', F.sName)}</select></label>
<button type="reset" class="chip">${F.reset}</button>
</form>
<p class="mono reg-count" id="reg-count" aria-live="polite">${esc(F.msg.replace('{n}', records.length).replace('{total}', records.length))}</p>
<p class="reg-none" id="reg-none" hidden>${F.none}</p>`;
  const kit = (cid) => SHOWCASE_PATH[cid] ? SHOWCASE_PATH[cid][L] : en ? `en/kit/${cid}/` : `sada/${cid}/`;
  const simText = (s) => { const v = String(s || 'unknown').trim(); return T.sim[v.toLowerCase()] != null ? [T.sim[v.toLowerCase()], false] : [v, true]; };
  const lastHtml = (m) => {
    if (!m || m === 'unknown') return NA;
    if (/^\d{4}-\d{2}$/.test(m)) { const [y, mo] = m.split('-'); return `<time datetime="${m}">${en ? m : `${+mo}/${y}`}</time>`; }
    if (/^\d{4}$/.test(m)) return `<time datetime="${m}">${m}</time>`;
    return `<span${lang}>${esc(m)}</span>`;   // year with the source's note, as written
  };
  const NA = `<span class="reg-na">${T.na}</span>`;
  const licText = (v, hide) => (hide || !v || NO_HW_LICENCE.test(v) && !/all rights reserved/i.test(v)) ? `<span class="reg-na">${T.naLic}</span>` : `<span${lang}>${esc(v)}</span>`;
  const items = sortRecords(records).map((r) => {
    const sum = en ? r.summary_en : cs[r.id];
    const lic = r.licenses || {}, H = hiddenFields(r), thin = H.has('all');
    const links = [];
    const seenU = new Set();
    for (const [k, t] of [['homepage', T.web], ['repo', T.repo], ['cad', T.cad]]) {
      if (!isUrl(r[k]) || seenU.has(r[k]) || (H.has(k) && !thin)) continue;
      seenU.add(r[k]);
      const label = PAPER.test(r[k]) ? T.paper : /zenodo/i.test(r[k]) ? T.zenodo : t;
      links.push(`<a href="${esc(r[k])}" rel="noopener">${label} <span aria-hidden="true">↗</span></a>`);
    }
    const cid = CATALOGUE[r.id];
    if (cid) links.unshift(`<a class="reg-kit" href="${root}${kit(cid)}">${SHOWCASE_PATH[cid] ? T.inShow : T.inCat} <span aria-hidden="true">→</span></a>`);
    const [simV, simRaw] = simText(r.sim_model);
    const disc = disciplineOf(r), hz = hazardsOf(r), HL = HAZARD_LABELS[L];
    if (r.fork_of) { const o = records.find((x) => x.id === r.fork_of); if (o) links.push(`<a class="reg-fork" href="#p-${esc(o.id)}">${T.forkOf} ${esc(o.name)}</a>`); }
    const text = fold([r.name, r.id, sum, T.cat[r.category], T.disc[disc], r.subcategory ? subcatLabel(L, r.subcategory, true) + ' ' + subcatLabel(L, r.subcategory) : '', thin || H.has('act') ? '' : r.actuation || '', H.has('hw') ? '' : lic.hardware || '', H.has('sw') ? '' : lic.software || ''].join(' '));
    // a field-of-use record shows "Biologie · Centrifuga"; a robot keeps "Robot na kolech · RC auto"
    const kind = disc === 'robotics' ? esc(T.cat[r.category]) + (r.subcategory ? ` · ${esc(subcatLabel(L, r.subcategory, true))}` : '')
      : `${esc(T.disc[disc])} · ${esc(r.subcategory ? subcatLabel(L, r.subcategory, true) : T.cat[r.category])}`;
    const head = `<li class="reg-i${thin ? ' reg-thin' : ''}" id="p-${r.id}" data-cat="${r.category}"${r.subcategory ? ` data-sub="${esc(r.subcategory)}"` : ''} data-disc="${disc}" data-rights="${r.rights_class}" data-printed="${r.printed_share}" data-maker="${r.fit.maker}" data-school="${r.fit.school}" data-last="${lastKey(r)}" data-name="${esc(fold(r.name))}" data-text="${esc(text)}">
<div class="reg-h"><h3>${esc(r.name)}</h3><span class="mono">${kind}</span></div>
<p class="reg-s">${esc(sum)}</p>${hz.length ? `\n<p class="reg-hz">${HL.pre}${hz.map((k) => HL[k]).join(', ')}${HL.post}</p>` : ''}`;
    // record whose details are all unverified: name, summary, one link
    if (thin && !links.length) {
      const u = (r.sources || []).map((x) => x.url).find(isUrl);
      if (u) links.push(`<a href="${esc(u)}" rel="noopener">${PAPER.test(u) ? T.paper : T.src} <span aria-hidden="true">↗</span></a>`);
    }
    if (thin) return `${head}
<p class="reg-a"><span class="reg-b reg-b-thin">${T.thin}</span>${links.slice(0, 1).join('')}</p>
</li>`;
    const actV = H.has('act') || !r.actuation || /^unknown$/i.test(r.actuation) ? NA : `<span${lang}>${esc(r.actuation)}</span>`;
    const simH = H.has('sim') ? NA : simRaw ? `<span${lang}>${esc(simV)}</span>` : esc(simV);
    const lastV = H.has('last') ? NA : lastHtml(r.maturity.last_activity);
    const stars = !H.has('stars') && r.maturity.stars != null ? ` · ${r.maturity.stars.toLocaleString(en ? 'en-GB' : 'cs-CZ')} ${T.stars}` : '';
    return `${head}
<p class="reg-lic"><span class="reg-b reg-b-${r.rights_class}"><span class="mk ${MK[r.rights_class]}" aria-hidden="true"></span>${T.rights[r.rights_class]}</span>
<span class="reg-lt">${T.hw}: ${licText(lic.hardware, H.has('hw'))}</span><span class="reg-lt">${T.sw}: ${licText(lic.software, H.has('sw'))}</span><span class="reg-lt">${T.docs}: ${licText(lic.docs, H.has('docs'))}</span></p>
<dl class="reg-d">
<div><dt>${T.act}</dt><dd>${actV}</dd></div>
<div><dt>${T.simL}</dt><dd>${simH}</dd></div>
<div><dt>${T.printedL}</dt><dd>${H.has('printed') ? NA : T.printed[r.printed_share]}</dd></div>
<div><dt>${T.last}</dt><dd>${lastV}${stars}</dd></div>
<div><dt>${T.fit}</dt><dd>${T.maker} ${r.fit.maker} ${T.of5} · ${T.school} ${r.fit.school} ${T.of5}</dd></div>
</dl>
<p class="reg-a">${links.join('')}</p>
</li>`;
  }).join('\n');
  return `${form}\n<ol class="reg-l" id="reg-l">\n${items}\n</ol>`;
}

// newest "checked" date among the sources (the page states it)
export function checkedDate(records) {
  return records.flatMap((r) => (r.sources || []).map((s) => s.checked)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort().at(-1) || null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { records, cs } = loadRegistry();
  const errors = checkRegistry(records, cs);
  if (errors.length) { console.error('registry check failed:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('registry ok:', records.length, 'projects');
}

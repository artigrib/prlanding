// Mission 13 page copy (src/ui/line.js): Czech source templates, formal "vy". The page fills them with t(s, vars)
// (src/i18n/index.js); every template has its English entry in src/i18n/en.js (tests/line-orders.test.mjs checks).
// Numbers in {placeholders} come from the model (src/line/des.js), the stored N_min search (src/line/nmin.js) or the
// measured profiles; none is written into the text.

export const COPY = {
  // editor
  scheme: 'Schéma linky',
  schemeSub: 'diskrétní simulace z naměřených dat',
  cell3d: 'Fyzikální buňka (MuJoCo)',
  orders: 'Zakázky',
  order: 'Zakázka {id}',
  orderF: '{F}/min',
  orderX: '· čistota ≥ {X} %',
  orderBelt: 'pás {v} cm/s · přítok {lambda}/min',
  orderBeltS: '{v} cm/s · {lambda}/min',
  orderMin: '★ nejvýš {n}',
  orderMinS: '★ ≤ {n}',
  orderAria: 'Zakázka {id}: {F}/min při čistotě ≥ {X} %, pás {v} cm/s, přítok {lambda}/min, nejvýš {n}',
  objective: 'Zakázka {id}: aspoň {F} kusů/min při čistotě ≥ {X} %, co nejméně robotů',
  inflow: 'přítok {lambda}/min',
  beltEnd: 'propadá',
  beltLen: 'pás {L} m · {v} cm/s',
  slot: '{x} m',
  addHere: 'Přidat buňku na {x} m',
  cellAria: 'Buňka na {x} m: {fr}. Upravit',
  noFraction: 'bez frakce',
  pickTitle: 'Buňka na {x} m',
  pickHelp: 'Dva koše: vyberte nejvýš dvě frakce. Šedý úsek na pásu je okno dosahu (naměřené).',
  upstream: '← Proti proudu',
  downstream: 'Po proudu →',
  remove: 'Odebrat buňku',
  done: 'Hotovo',
  clear: 'Vyprázdnit linku',
  addCell: 'Přidat buňku',
  run: 'Spustit linku',
  full: 'Linka je plná: {n} buněk',
  howTo: 'Jak to počítáme',
  count: 'Buňky: {n} z {max}',
  needCell: 'Přidejte aspoň jednu buňku.',
  needFraction: 'Buňka na {x} m nemá frakci.',
  loading: 'Načítám naměřený profil Skriptu…',
  loadFail: 'Profil se nenačetl: {err}',
  policy: 'Politika všech buněk: Skript (plánovač), profil naměřený v CI',
  // running
  computing: 'Počítám {seeds} běhů po {min} minutách…',
  runOf: 'Běh {k} z {n}',
  replay: 'Přehrávka běhu 1, {x}× zrychleně',
  skip: 'Přeskočit',
  last: 'Poslední běh: {sorted}/min · čistota {purity} · propadá {missed}/min',
  util: '{u} %',
  utilAria: 'vytížení {u} %',
  // objective after a run
  failLine: 'Nesplněno: výstup {sorted}/min (cíl {F}), čistota {purity} {mark}',
  winLine: 'Splněno: {sorted}/min, čistota {purity}…',
  // result card
  mRobots: 'Roboti',
  mOutput: 'Výkon',
  mPurity: 'Čistota',
  mMissed: 'Propadlo',
  vOutput: '{mean}/min',
  vBand: '5–95 %: {p5}–{p95}',
  vMin: 'minimum {n}',
  vTarget: 'cíl {F}',
  vTargetX: 'cíl ≥ {X} %',
  vPerMin: '{m}/min',
  histOwn: 'vaše běhy ({n})',
  histFirst: 'první běh této zakázky',
  histNow: 'tento běh',
  headFail: 'Linka roztřídí {sorted}/min – zakázka chce {F}.',
  headFailPurity: 'Čistota {purity} – zakázka chce aspoň {X} %.',
  headWin: 'Linka splnila zakázku {id}.',
  starWin: '★ splněno',
  starWinNo: '☆ splněno: {sorted}/min, cíl {F}',
  starsNeedWin: 'Hvězdy za rezervu a za počet robotů se počítají až se splněnou zakázkou.',
  starReserve: '★ rezerva: i v horších 10 % běhů ≥ {F}/min',
  starReserveNo: '☆ rezerva: v horších 10 % běhů jen {p10}/min, cíl {F}',
  reserveNone: 'U zakázky {id} nemá rezervu žádná linka s {n} buňkami: rezervu i minimum robotů tu naráz získat nejde.',
  starMin: '★ minimum robotů: {n}',
  starMinNo: '☆ robotů {n}, stačí {nmin}',
  assisted: 'Linku načetla nápověda – splněno, bez hvězdiček.',
  where: 'Rozbor linky',
  missedBy: 'Propadá za minutu: {list}',
  cellRow: 'Buňka na {x} m ({fr}): vytížení {u} %, roztřídí {s}/min',
  realism: 'Průmyslové třídicí roboty: výrobci uvádějí 40–80 úchopů/min při pásu 0,5–1 m/s (údaj výrobce). Jedna SO-101 v této zakázce: v modelu nejvýš {cap}/min při {v} cm/s. SO-101 je výuková ruka – učí princip, ne průmyslový výkon.',
  sources: 'Zdroje údajů výrobců:',
  editLine: 'Upravit linku',
  // "Jak to počítáme"
  close: 'Zavřít',
  nminText: 'Minimum robotů pro zakázku {id}: {n}. Vyhledávání prověřilo každou linku s nejvýš {n} buňkami (každá buňka jedna nebo dvě frakce, v každém pořadí, buňky vedle sebe od začátku pásu); s {n} buňkami zakázku splní {passing} z {total}.',
  nminReserve: 'Z nich {reserve} splní cíl i v horších 10 % běhů (★ rezerva).',
  nminReserveNone: 'Žádná z nich nesplní cíl i v horších 10 % běhů: ★ rezerva tu chce víc buněk.',
  arrivalsUniform: 'Přijíždění v zakázkách: rovnoměrně, {lambda} kusů za minutu, takže linka nic neodmítne.',
  // hints
  hintCap: 'Jedna buňka v této zakázce roztřídí v modelu nejvýš {cap}/min (nejlepší dvojice: {pair}). Na {F}/min tedy potřebujete aspoň {k}. Po běhu ukazuje schéma u každé buňky vytížení a pod pásem, co propadá.',
  hintShow: 'Načte linku, kterou našlo vyhledávání: {n}, v modelu {sorted}/min. Mise se pak počítá jako splněná, bez hvězdiček.',
  shown: 'Načtena linka z vyhledávání. Spusťte ji.'
};

/** Czech plural forms: [1, 2–4, 5+] with {n}. */
export const PLURAL = {
  robot: ['{n} robot', '{n} roboti', '{n} robotů'],
  cell: ['{n} buňka', '{n} buňky', '{n} buněk']
};
export const plural = (kind, n) => PLURAL[kind][n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2];

/** Manufacturer figures of the realism line (design §9), each "údaj výrobce" or a press report. */
export const VENDOR_SOURCES = [
  { label: 'Terex ZenRobotics Fast Picker', href: 'https://www.terex.com/zenrobotics/robots/fast-picker' },
  { label: 'BHS Max-AI AQC-1', href: 'https://www.targikielce.pl/storage/file/core_files/2025/4/1/c9308d776a2cc14d08165500ace632d3/Max-AI-AQC-1-Europe-spec-sheet-2025.pdf' },
  { label: 'BHS Max-AI AQC-C', href: 'https://www.recyclingtoday.com/news/bhs-launches-max-ai-aqc-c-robotic-sorter' }
];

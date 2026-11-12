// "Jak to počítáme": the model description of the mission 13 line (src/line/des.js) for the page (PR 9 shows it
// in the line editor). Czech source strings; English in src/i18n/en.js. Templates carry {placeholders} that the page
// fills with t(s, vars). DOM-free: plain data.
//
// Every claim here is either a rule of des.js or a measured number with its source. Keep them in step: when the
// model changes, change this text (tests/des.test.mjs checks the constants it quotes).

export const EXPLAIN = {
  title: 'Jak to počítáme',
  intro: 'Linka je diskrétní simulace: počítá události (příjezd předmětu, úchop, návrat ruky), ne fyziku. Všechno, co ví o buňce, pochází z měřicí buňky: jedna SO-101 v MuJoCo, vždy jeden předmět na pásu, 100 předmětů z každé frakce při každé rychlosti pásu.',
  sections: [
    {
      title: 'Co se bere z měření',
      items: [
        'Okno dosahu pro každou frakci: úsek pásu, kde se úchop dařil aspoň z poloviny tak často jako v nejlepším místě. Mimo okno buňka nesahá.',
        'Čas úchopu a čas návratu ruky: losujeme z naměřeného seznamu. Žádný průměr ani dosazené rozdělení.',
        'Výsledek pokusu (úspěch nebo druh chyby) a jeho čas losujeme z pokusů naměřených ve stejném místě pásu (po 4 cm), takže úspěšnost se mění podél okna jako při měření.',
        'Každá chyba stojí tolik času, kolik trvala při měření.'
      ]
    },
    {
      title: 'Pravidla linky',
      items: [
        'Volná buňka vezme předmět své frakce, který je nejdál po proudu a který zachytí uvnitř okna. Jinak čeká.',
        'Předmět si buňka zamluví, takže ho jiná buňka nevezme současně. Na jeden předmět má každá buňka nejvýš 2 pokusy.',
        'Minutí nebo upuštění zpět na pás: předmět jede dál a může ho vzít další buňka. Shození nebo upuštění mimo pás: předmět je ztracený. Upuštění do druhého koše buňky: koš je znečištěný.',
        'Předměty potřebují na pásu aspoň 8 cm. Co by přijelo blíž k předchozímu, linka nepřijme a počítá to jako nepřijaté.',
        'Přijíždění: náhodně (Poissonův proces) nebo rovnoměrně. Složení zakázky je herní zadání, ne statistika skutečného odpadu.'
      ]
    },
    {
      title: 'Jak se počítá výsledek',
      items: [
        'Nejdřív se pás naplní (předmět dojede od začátku na konec), pak se počítá 30 minut provozu.',
        '20 běhů s různými náhodnými čísly. Ukazujeme průměr a rozmezí, do kterého padlo 90 % běhů (5–95 %).',
        'Výkon: roztříděné kusy za minutu, jen ty ve správném koši. Čistota: podíl správných kusů ve všech koších.'
      ]
    },
    {
      title: 'Co model nezná',
      items: [
        'Měřilo se vždy s jedním předmětem na pásu a s prázdnými koši. Plné koše, odrazy v koši a předměty těsně u sebe v modelu nejsou.',
        'Sousední buňky si fyzicky nepřekážejí: stojí 0,5 m od sebe a každá má své koše.',
        'Pás se nezastavuje, nic se nezasekne, koše se nevyměňují.',
        'Rozpoznávání je dokonalé (simulace). Skutečné linky se pletou i v tom, co předmět je.',
        'Předmět leží na pásu nejvýš 1,5 cm od osy, jako při měření.',
        'Pokusy jsou na sobě nezávislé: každý se losuje zvlášť z naměřených pokusů.',
        'Předmět, který spadl zpět na pás, jede dál z místa, kde by byl, kdyby ho nikdo nezvedl.'
      ]
    }
  ],
  // templates, filled by the page
  beltMax: 'Při {v} cm/s se na pás vejde nejvýš {max} kusů/min.',
  profile: 'Profil: {policy}, {v} cm/s, naměřeno {date} ({source}), {n} pokusů.',
  check: 'Kontrola modelu: jedna buňka na pásu mise 11 (11 předmětů po 10 s, 2 cm/s) roztřídí v modelu průměrně {des} z 11. Skript v MuJoCo na stejném pásu: {measured} z 11 ({runs} dávek). Model je optimističtější, protože měřicí buňka měří s prázdnými koši.'
};

/** The mission 11 batches measured in MuJoCo, for EXPLAIN.check: tools/belt-measure.mjs batch --n 10 --speed 0.02
 *  (beltSolve, seeds 1–10, one item every 10 s), re-run on the code of this PR. */
export const M11_BATCH = {
  sorted: [11, 11, 8, 10, 11, 9, 11, 11, 11, 11], of: 11, purity: 1,
  source: 'tools/belt-measure.mjs batch --n 10 --speed 0.02', measured_at: '2026-11-12',
  lost: 'seed 3: a vial released beside its bin, the plastic cup released and fell to the tote, the nut missed then too late; seed 4: a vial left to pass, its bin full; seed 6: the spoon released and fell to the tote, a paper cup too late'
};

/** The order mix of the mission 11 batch (2 paper, 3 plastic, 3 glass, 3 metal of 11): the default "složení zakázky"
 *  of the line tools and the mix of the mission 13 orders (a game parameter, not a statistic of real waste). */
export const M11_MIX = { paper: 2, plastic: 3, glass: 3, metal: 3 };

/** The mission 11 cell in the line model, for EXPLAIN.check: one cell with all four fractions on the mission 11 belt
 *  (0.53 m from the spawn point to the tote edge, the cell 0.26 m downstream of it), 11 items one every 10 s at 2 cm/s
 *  in the batch mix (world.js spawn: y = BELT.y0 + BELT.entry / 2 = −0.26; the belt edge BELT.edge = 0.27). */
export function m11Config() {
  return { v: 0.02, lambda: 6, arrivals: 'uniform', jitter: 0, mix: M11_MIX, length: 0.53, count: 11,
    cells: [{ x: 0.26, fractions: ['paper', 'plastic', 'glass', 'metal'], policy: 'skript' }] };
}

/** Source labels of a profile (profile.source). */
export const SOURCE = { ci: 'v CI', browser: 'v prohlížeči', sil: 'v SIL' };

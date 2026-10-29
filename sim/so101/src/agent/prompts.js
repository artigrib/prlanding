// "Co říct AI": ready-made prompts for the "Připojit AI" panel (F1). Czech is the source; the English text comes
// from src/i18n/en.js like every other string. Each prompt is known to be doable with the 13 tools of the relay.
// About half are "explain / coach / let me try" prompts: the AI shows or hints and the person does the next step.

export const PROMPT_GROUPS = [
  {
    id: 'start', title: 'Začátek',
    items: [
      'Podívej se snímkem z kamery a řekni mi, co vidíš na stole.',
      'Dojeď chapadlem nad kostku, pak nad misku a vrať se do výchozí polohy.',
      'Jaké mise tahle simulace nabízí? Vyber pro začátek tu nejjednodušší.'
    ]
  },
  {
    id: 'missions', title: 'Mise s AI',
    items: [
      'Vysvětli mi, jak by ses dostal ke kostce, a nech mě to zkusit.',
      'Spusť misi 01, udělej první krok a pak mi řekni, co mám udělat já.',
      'Postav věž: polož oranžovou kostku přesně na modrou (mise 02).'
    ]
  },
  {
    id: 'fun', title: 'Zábava',
    items: [
      'Zatanči s robotickou rukou: jeden plynulý tanec přes 10 bodů, chapadlo ať klape do rytmu.',
      'Zamávej mi chapadlem třikrát a pak se ukloň.',
      'Vymysli krátký pohyb, popiš mi ho slovy a nech mě ho zopakovat posuvníky.'
    ]
  },
  {
    id: 'learn', title: 'Učení',
    items: [
      'Vysvětli, co je inverzní kinematika, a ukaž to pohybem k bodu x 250, y 0, z 80 mm.',
      'Pohni postupně každým kloubem o 20° a řekni mi, k čemu který kloub slouží.',
      'Neřeš to za mě: napověz mi, kterým kloubem mám pohnout, aby se chapadlo dostalo ke kostce.'
    ]
  }
];

/** The prompt for one mission ("Zeptej se AI" on the mission card). `n` and `title` are already in the page language. */
export const MISSION_PROMPT = 'Spusť misi {n} „{title}“ a vyřeš ji. Po každém kroku zkontroluj stav mise a na konci mi řekni, jak to dopadlo.';

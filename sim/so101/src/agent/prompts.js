// "Co říct AI": ready-made prompts for the "Připojit AI" panel (F1). Czech is the source; the English text comes
// from src/i18n/en.js like every other string. Each prompt is known to be doable with the 13 tools of the relay.

export const PROMPT_GROUPS = [
  {
    id: 'start', title: 'Začátek',
    items: [
      'Řekni mi, co je na stole, a ukaž mi to na snímku z kamery.',
      'Dojeď chapadlem nad kostku, pak nad misku a vrať se do výchozí polohy.',
      'Jaké mise tahle simulace nabízí? Vyber pro začátek tu nejjednodušší.'
    ]
  },
  {
    id: 'missions', title: 'Mise pro AI',
    items: [
      'Spusť misi 01 a přenes oranžovou kostku do modré misky.',
      'Postav věž: polož oranžovou kostku přesně na modrou (mise 02).',
      'Roztřiď barvy v misi 03 a po každém kroku zkontroluj stav mise.'
    ]
  },
  {
    id: 'fun', title: 'Zábava',
    items: [
      'Zatanči s robotickou rukou: jeden plynulý tanec přes 10 bodů, chapadlo ať klape do rytmu.',
      'Zamávej mi chapadlem třikrát a pak se ukloň.',
      'Nakresli chapadlem ve vzduchu nad stolem srdce.'
    ]
  },
  {
    id: 'learn', title: 'Učení',
    items: [
      'Vysvětli, co je inverzní kinematika, a ukaž to pohybem k bodu x 250, y 0, z 80 mm.',
      'Pohni postupně každým kloubem o 20° a řekni mi, k čemu který kloub slouží.',
      'Vysvětli dětem ve třech větách, co jsi právě udělal.'
    ]
  }
];

/** The prompt for one mission ("Zeptej se AI" on the mission card). `n` and `title` are already in the page language. */
export const MISSION_PROMPT = 'Spusť misi {n} „{title}“ a vyřeš ji. Po každém kroku zkontroluj stav mise a na konci mi řekni, jak to dopadlo.';

# Aréna 150 g – changelog

## v2 (branch `arena-v2`)

### Hra a UX
- **Režimy:** Rychlý zápas proti AI (Začátečník / Pokročilý / Mistr), Turnaj (žebříček tří soupeřů, postup v localStorage),
  Dva hráči na jedné klávesnici (WASD + mezerník / šipky + Enter, nebo dva gamepady, volitelně rozdělená obrazovka)
  a Tréninková hala bez časového limitu (figurína, přepínač „Soupeř jezdí“, návrat na start klávesou R, počítadlo K.O.).
- **AI s povahou** (`src/ai.js`): začátečník reaguje pomalu a míří nepřesně, pokročilý předsazuje a používá zbraň,
  mistr obchází přední stranu soupeřovy zbraně, tlačí ho k jámě, okamžitě se převrací zpět a spinner si nechává roztočit.
  Využívá `robot.suggestFire()` z fyziky.
- **Kamery** (`src/cameras.js`, klávesa C / tlačítko): TV přenos, za robotem, shora, FPV z robota; plynulé přechody,
  kinematická orbita pro záznamy a garáž; na telefonu na výšku TV kamera sleduje oba roboty.
- **Okamžitý záznam K.O.:** kruhový buffer transformací (6 s, 120 Hz) včetně animovaných dílů; zpomaleně z orbity,
  přeskočitelné (mezerník / Enter / Esc / tlačítko), znovu z obrazovky konce.
- **Rozhodčí:** při vypršení času tři rozhodčí dělí body Poškození (5), Agrese (3), Kontrola (3); tabulka na konci zápasu.
- **Garáž:** volba dílů po slotech z datového modelu fyziky (kola, převody, zbraň, pancíř, elektronika), rozpočet 150 g
  s blokováním přetížených kombinací, ukazatele vlastností, barva tisku.
- **Výběr arény** z registru map (5 arén) s popisem; stav nástrah (`map.status()`) pod časomírou.
- **Šťáva:** hit-stop při silných zásazích, jiskry, otřesy kamery (vypínatelné, respektují reduced-motion),
  plovoucí štítky zásahů a poškození („Kolo upadlo!“), ukazatel poškození v HUD, zpomalení při K.O.
- **Zvuk:** vše syntetizované přes WebAudio (motory, zbraň, nárazy, flipper, odpočet, siréna, publikum), ztlumení klávesou M.
- **Pauza** (Esc / P): pokračovat, od začátku, do menu, nastavení otřesů a automatického záznamu.
- **Konec zápasu:** Znovu / Další soupeř / Menu / Záznam K.O. / Sdílet výsledek (Web Share nebo kopie odkazu),
  stavebnice „Postavte si ho“, u připravovaných „Dejte mi vědět“.
- Celé UI ve vykání; zachovány licence a odkaz na NOTICE, fallbacky (bez WebGL, bez JS, starý prohlížeč), ovládání klávesnicí,
  aria-live jen při změně.

### Fyzika a roboti
Viz `TEAM.md` (PHYSICS): datově řízený katalog robotů (SVRN, vertikální spinner, Kosa, Klepeto), modifikace,
poškození po stranách, baterie a pohon.

### Arény
Viz `TEAM.md` (MAPS): CCRL klasika, Jáma a rampy, Kladivo, Led, PROTO ROBOT Praha; nástrahy, trosky, publikum.

### Testy
Playwright smoke test přes `?debug` hook `window.__arena` (`sim()`, `frame()`, `halt`, `setMode()`, `cycleCam()`, …).

### Známé limity
- AI vs. AI (headless turnaj 16 zápasů na mapu): Pokročilý porazí Začátečníka zhruba 2 : 1, Mistr je proti oběma jen mírně lepší –
  zápasy rozhoduje hodně chaos fyziky (rychlá K.O. do jámy). Kosa jako hráčova strana v self-play prohrává skoro vždy.
- Výkon na skutečných telefonech nebyl měřen (testováno jen v SwiftShaderu); pro slabé GPU je adaptivní pixel ratio (1,75 → 1).
- Rozdělená obrazovka je jen pro klávesnici / gamepady, na dotykovém displeji ovládá jen hráč 1.

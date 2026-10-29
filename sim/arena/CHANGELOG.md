# Aréna 150 g – changelog

## SVRN s výměnnými moduly (branch `svrn-rig`)
- **Nový model `models/svrn.glb`** (260 kB, meshopt): parametrický model podvozku Project SVRN
  (Shoverobotics, CC BY 4.0) z `tools/robots-cad/svrn.py`, místo surového exportu STL dílů bez zbraně a bez rigu.
  Pojmenované uzly `frame`, `wheel_1..4` (osy kol), `flipper` (kloub), přesně v souřadnicích simulace (`glbNative`),
  takže kola a zbraň se animují bez regexů a dopasování měřítka.
- **Moduly vpředu** (naše modely podle modulárního konceptu SVRN, CC BY 4.0): flipper (ocelová deska, závěsy,
  páka serva), klín (pevný, nižší a delší) a chapadlo (vidlice + kleště). Nový slot garáže **Modul**:
  Flipper / Klín (−9 g, bez serva, nestřílí) / Chapadlo (+3 g, chytí a odveze jako Klepeto). Fyzika modulu se mění s ním.
- Flipper je vidět i v klidu a při výstřelu se zvedá (dříve se schematická deska ukazovala jen při výstřelu).
- 3D náhled na stránce sady ukazuje jen modul flipper (ostatní `opt_*` uzly skrývá).
- Celý robot: víko (tmavé), tmavé náboje kol, ocelová deska a spojovací materiál zvlášť od tištěného těla (barva tisku jen na tělo).
- **Nové rendery** `img/svrn_{white,grey,black,orange,blue}.jpg` (hero sady CZ/EN, karta v katalogu, home) z nového modelu
  přes `tools/render-kit/` (Playwright + three.js, 1200×900) a nový snímek `assets/media/arena.jpg` (SVRN vyhazuje Klepeto).

## Opravy po QA a první zápas (branch `arena-fixes`)
- **Přes stěnu už nelétá:** nad 12cm stěnou je neviditelný polykarbonátový „strop“ do 36 cm (`CATCH_H`, `maps/kit.js`),
  výjimkou jsou výjezdy a rampy v Jámě (`spec.openTop`). AI matice Mistr i Střední: Kladivo + Praha 0 / 48 zápasů
  končí vyletěním (dříve 13 / 48); na Klasice a Ledu jen skrz výjezdy.
- **Hodiny běží v simulovaném čase:** odpočet zápasu tiká s každým fyzikálním krokem, simulace dohání až 0,1 s za snímek.
  Na pomalém zařízení (10 fps) zápas trvá déle, ale obsahuje celé 2:00 akce; jáma v Praze se otevře v 1:00 na hodinách.
- **Patové situace:** AI bez kontaktu 6 s na 3 s zaútočí naplno (Mistr přestane obcházet spinner); pravidlo přišpendlení:
  10 s u stěny bez pohybu → „Rozhodčí: roboti od sebe!“ a návrat na start; rozhodčí při shodě berou aktivitu a zápas
  bez zásahů a útoků končí remízou.
- SVRN se při výstřelu do Klepeta/Kosy už nepřevrací sám (reakce flipperu přes těžiště, omezení náklonu po výstřelu).
- Garáž se na telefonu otevře nahoře; jméno soupeře v HUD se nezařezává (krátká jména pod 760 px, výpustka);
  Klepeto má v nápovědě a stavu „kleště“; po obnovení grafiky je zápas pozastavený; na konci zápasu má fokus nadpis
  (mezerník nespustí hned nový zápas); `aria-pressed` u zvuku = ztlumeno; „1,2 m“; kvíz už nenabízí Otto jako
  bojového robota; prázdný klip ohlásí chybu, na dotykových zařízeních klip 15 fps; jemnější stíny (normalBias).
- **První zápas:** krátký průvodce přes odpočet (3 řádky, Enter / Esc / „Přeskočit“, jen jednou), výchozí obtížnost
  Začátečník (střední úroveň přejmenována na „Střední“), po prohře v rychlém zápase tlačítko „Zkusit lehčího soupeře“
  a v menu odkaz „↓ Další nastavení“, dokud je spodek panelu schovaný. Vše i v angličtině.

## Záznamy zápasů (branch `arena-replays`)
- **Nahrávání** (`src/replay/codec.js`, `src/replay/scene.js`): každý zápas se zaznamenává 30× za sekundu – poloha a natočení
  obou robotů, kola (i upadlá), zbraň / flipper / čelist, roztočení, HP, převrácení, zásahy, stav nástrah a volné trosky.
  Kvantováno, delta + run-length + varint po 5s blocích, kruhový buffer (zápas + 60 s, trénink 5 min).
  3 minuty ≈ 50 kB v souboru, < 100 kB v paměti. Události: zásah, převrácení, jáma, mimo arénu, K.O., upadlé kolo.
- **Přehrávač** (`src/replay/player.js`, `src/ui/replay.js`): přehrává snímky, ne fyziku. Play/pauza, časová osa
  s značkami událostí, skok na předchozí/další zásah, rychlost 0,25×–2×, automatické zpomalení u velkých zásahů,
  kamery Režisér (automatická TV režie), TV, za robotem, shora, z robota a volná orbita (tažení, kolečko, pinch).
  Klávesy: mezerník, ←/→, `,` `.`, C, F, 1–4, Esc. Velká dotyková tlačítka, na telefonu přes celou šířku.
- **Kde:** „Opakovat K.O. / Opakovat zásah“ (automaticky po K.O.) a „Celý zápas“ na konci, „Záznam posledních 20 s“ v pauze.
- **Soubor .prreplay** (gzip JSON) – „Uložit záznam“ a v menu „Přehrát uložený záznam“; aréna a roboti se postaví z hlavičky.
  Háček pro sdílené odkazy: `replayHooks.upload` (tlačítko „Sdílet odkaz“ se ukáže, až bude backend) a `?replay=<cesta>`.
- **Klip 10 s** – WebM přes MediaRecorder ke stažení; skryto, když to prohlížeč neumí.
- **Bezpečný import:** soubor se celý ověří dřív, než se cokoli změní – prázdné / děravé bloky, limity kanálů, bloků
  a událostí, rozbalení gzipu max. 64 MB (ochrana proti „gzip bombě“), nástrahy jen s povolenými klíči, události jen se
  známými poli, žádné `__proto__`. Chyby jsou vždy česky; když se přehrávač nepodaří otevřít, hra se vrátí do menu
  (Esc funguje vždy). `?replay=` přijme jen relativní cestu na stejném původu. Zavření záznamu ze souboru vrací kola
  a nástrahy do původního stavu; obnovení WebGL kontextu respektuje záznam a pauzu.
- Otevření záznamu nejdřív zavře případný běžící záznam (dva záznamy přes sebe), chybový panel skryje přehrávač.
- Testy: `node tests/replay-codec.test.mjs` (round trip, rozpočet velikosti, ring buffer) a `tests/replay-e2e.cjs`
  (Playwright: menu → zápas → konec → záznam, shoda poloh po uložení/načtení < 2 mm, 3 min < 300 kB, klip).

## Modely robotů (branch `arena-models`)
- **Kosa a Klepeto mají vlastní 3D modely** (`models/kosa.glb` 211 kB, `models/klepeto.glb` 241 kB, meshopt):
  původní parametrické návrhy v build123d (`tools/robots-cad/`), CC BY 4.0. Tištěná vana se zkosenými hranami,
  víko s gravírovaným jménem, šrouby, náboje s paprsky, pneumatiky se vzorkem; Kosa: outrunner na výložníku,
  ocelová tyč s břity (varianty disk / lehká čepel), Klepeto: zvedák s ocelovou lopatou a hroty, čelist se zuby a servem.
- Modely jsou v jednotkách a souřadnicích simulace (`glbNative`): kola, čepel, zvedák a čelist mají pivot v počátku uzlu,
  takže se animují přesně kolem os z katalogu; koliderům odpovídá rozvor, poloměr kol i půdorys.
- Uzly `opt_<slot>_<volba>` se zobrazí jen s danou úpravou z garáže (titanový štít, TPU boky, typ čepele).
- Procedurální náhradní vzhled (`robots/visuals.js`) bez hrubých kvádrů: zaoblené a zkosené výlisky, soustružené pneumatiky
  se vzorkem, náboje, šrouby – pro načítání a pro budoucí roboty bez GLB. SVRN a vertikální spinner mají pevný
  `glbFit`, jejich měřítko se nemění.
- Rozmazaný disk zbraně u GLB modelů respektuje poloměr a osu zbraně (horizontální spinner už nemá svislý disk).

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

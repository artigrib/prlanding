// English string table for the combat arena (index.html + src/**). Czech source text → English.
// Matched whole after trimming, so menus, HUD, garage and replay UI are translated in the DOM
// without touching game code; strings built from pieces need a pattern. Map floor decals drawn
// on canvas go through t() explicitly. Robot names stay as they are (Kosa, Klepeto, Project SVRN).
// Check coverage: node tools/i18n-extract.mjs sim/arena/src/i18n/en.js sim/arena/src sim/arena/index.html
const T = (s) => (globalThis.PRI18N ? globalThis.PRI18N.t(s) : s);
const dec = (s) => String(s).replace(/(\d),(\d)/g, '$1.$2');

const strings = {
  /* shell */
  'Aréna 150 g': '150 g Arena', 'Aréna pro bojové roboty': 'Combat robot arena', 'Vyzkoušejte v aréně': 'Try it in the arena', '← zpět na sadu': '← back to the kit', 'Zpět na sadu': 'Back to the kit',
  'Tento prohlížeč je příliš starý na 3D arénu.': 'This browser is too old for the 3D arena.', 'Aréna se nespustila': 'The arena didn’t start',
  'Aréna potřebuje JavaScript': 'The arena needs JavaScript', 'Zapněte JavaScript, nebo se vraťte na': 'Turn on JavaScript, or go back to',
  'Váš prohlížeč nepodporuje 3D grafiku (WebGL), takže arénu nespustíme. Robota si můžete prohlédnout na stránce sady.': 'Your browser doesn’t support 3D graphics (WebGL), so the arena can’t start. You can still look at the robot on its kit page.',
  'Grafika prohlížeče se zastavila. Zkuste stránku načíst znovu.': 'The browser’s graphics stopped. Try reloading the page.',
  'Fyzikální engine se nepodařilo načíst. Zkuste stránku obnovit.': 'The physics engine failed to load. Try reloading the page.',
  'Arénu se nepodařilo spustit. Zkuste stránku obnovit.': 'The arena failed to start. Try reloading the page.',
  'Načítám…': 'Loading…', 'Licence a zdroje': 'Licences and sources',
  '3D modely: Project SVRN – Shoverobotics (CC&nbsp;BY&nbsp;4.0); vertikální spinner – TheBlackfish, remix „150g vert“ od Muffin578 (CC&nbsp;BY-SA&nbsp;4.0), upraveno. Zvuky jsou syntetizované.': '3D models: Project SVRN – Shoverobotics (CC BY 4.0); vertical spinner – TheBlackfish, remix of “150g vert” by Muffin578 (CC BY-SA 4.0), modified. Sounds are synthesised.',
  '3D modely: Project SVRN – Shoverobotics (CC BY 4.0); vertikální spinner – TheBlackfish, remix „150g vert“ od Muffin578 (CC BY-SA 4.0), upraveno. Zvuky jsou syntetizované.': '3D models: Project SVRN – Shoverobotics (CC BY 4.0); vertical spinner – TheBlackfish, remix of “150g vert” by Muffin578 (CC BY-SA 4.0), modified. Sounds are synthesised.',
  '3D modely: Shoverobotics (CC BY 4.0), TheBlackfish / Muffin578 (CC BY-SA 4.0).': '3D models: Shoverobotics (CC BY 4.0), TheBlackfish / Muffin578 (CC BY-SA 4.0).',
  /* menu */
  'Vytlačte soupeře z arény nebo do jámy, případně ho převraťte tak, aby se 10&nbsp;s nemohl hýbat. Zápas trvá 2 minuty, pak rozhodují rozhodčí.': 'Push your opponent out of the arena or into the pit, or flip them so they can’t move for 10 s. A match lasts 2 minutes, then the judges decide.',
  'Vytlačte soupeře z arény nebo do jámy, případně ho převraťte tak, aby se 10 s nemohl hýbat. Zápas trvá 2 minuty, pak rozhodují rozhodčí.': 'Push your opponent out of the arena or into the pit, or flip them so they can’t move for 10 s. A match lasts 2 minutes, then the judges decide.',
  'Režim hry': 'Game mode', 'Režim': 'Mode', 'Robot': 'Robot', 'Barva tisku': 'Print colour', 'Garáž a úpravy': 'Garage and upgrades', 'Aréna': 'Arena', 'Obtížnost': 'Difficulty',
  'Rychlý zápas': 'Quick match', 'Jeden zápas proti AI': 'One match against the AI', 'Turnaj': 'Tournament', 'Tři soupeři za sebou': 'Three opponents in a row',
  'Dva hráči': 'Two players', 'Jedna klávesnice': 'One keyboard', 'Tréninková hala': 'Training hall', 'Bez časového limitu': 'No time limit',
  'Bílá': 'White', 'Šedá': 'Grey', 'Černá': 'Black', 'Oranžová': 'Orange', 'Modrá': 'Blue',
  'Začátečník': 'Beginner', 'Pomalé reakce, učí se jezdit': 'Slow reactions, still learning to drive', 'Pokročilý': 'Advanced', 'Míří, tlačí a používá zbraň': 'Aims, pushes and uses its weapon',
  'Mistr': 'Master', 'Obchází zbraň a tlačí do jámy': 'Dodges your weapon and pushes you into the pit', 'Figurína': 'Dummy', 'Stojí a čeká': 'Stands and waits',
  'Kancelářská sponka': 'Paper Clip', 'Bzučák': 'Buzzer', 'Ocelová Máňa': 'Steel Mabel',
  'Žebříček': 'Ladder', 'Začít turnaj znovu': 'Restart the tournament', '· poražen': '· beaten', '· na řadě': '· up next', 'Robot hráče 2': 'Player 2’s robot',
  '· Hráč 2: šipky +': '· Player 2: arrows +', 'přepne na rozdělenou obrazovku.': 'switches to split screen.', '· nebo dva gamepady.': '· or two gamepads.',
  'Volná jízda bez časového limitu. Soupeř stojí jako figurína – tlačítkem': 'Free driving with no time limit. The opponent stands still like a dummy – press', 'ho rozjedete.': 'to set it moving.',
  'vrátí oba roboty na start.': 'puts both robots back at the start.', 'Úpravy pro tohoto robota připravujeme.': 'Upgrades for this robot are coming soon.',
  'Přehrát uložený záznam (.prreplay)…': 'Play a saved replay (.prreplay)…',
  /* robots, garage */
  'Pohon 4×4, klín a flipper': '4×4 drive, wedge and flipper', 'Vertikální spinner 150 g': '150 g vertical spinner', 'Dvoukolový vertikální spinner': 'Two-wheel vertical spinner',
  'Kosa – horizontální spinner': 'Kosa – horizontal spinner', 'Nízký podřezávač s dlouhou čepelí': 'Low undercutter with a long blade',
  'Klepeto – zvedák s kleštěmi': 'Klepeto – lifter with a clamp', 'Chytí soupeře, zvedne ho a odveze': 'Grabs the opponent, lifts them and carries them off',
  'Klín': 'Wedge', 'Kola': 'Wheels', 'Převody': 'Gearing', 'Flipper': 'Flipper', 'Zbraň': 'Weapon', 'Kleště': 'Clamp', 'Pancíř': 'Armour', 'Elektronika': 'Electronics',
  'TPU pneu': 'TPU tyres', 'Tištěné TPU pneumatiky, dobrý kompromis': 'Printed TPU tyres, a good compromise', 'Silikonové': 'Silicone', 'Lepí se k podlaze, víc trakce na tlačení, +1 g/kolo': 'Stick to the floor, more traction for pushing, +1 g/wheel',
  'Pěnová': 'Foam', 'Lehká a měkká, méně přilnavá, −2 g/kolo': 'Light and soft, less grip, −2 g/wheel', 'Tvrdé PLA': 'Hard PLA', 'Kloužou – snadno se točí, špatně tlačí': 'Slippery – turn easily, push badly',
  'Standard': 'Standard', 'Vyvážená rychlost a síla': 'Balanced speed and power', 'Rychlý převod': 'Fast gearing', 'O ~25 % rychlejší, slabší při tlačení': 'About 25 % faster, weaker when pushing',
  'Silný převod': 'Strong gearing', 'Pomalejší, ale přetlačí skoro každého': 'Slower, but out-pushes almost anyone', 'Servo 25 kg': '25 kg servo', 'Standardní flipper': 'Standard flipper',
  'Silné servo': 'Strong servo', 'Hodí výš, nabíjí déle, +5 g': 'Throws higher, recharges longer, +5 g', 'Rychlé servo': 'Fast servo', 'Kratší nabíjení, slabší kop, −2 g': 'Shorter recharge, weaker kick, −2 g',
  'Ocelová tyč': 'Steel bar', 'Standardní čepel': 'Standard blade', 'Těžký disk': 'Heavy disc', 'Víc energie (½Iω²), roztáčí se déle, +8 g': 'More energy (½Iω²), takes longer to spin up, +8 g',
  'Lehká čepel': 'Light blade', 'Rychle roztočená, slabší zásah, −8 g': 'Spins up fast, weaker hit, −8 g', 'Drží až 5 s': 'Holds for up to 5 s', 'Zvedne výš, +5 g': 'Lifts higher, +5 g',
  'Vidlice': 'Forks', 'Dvě nízké vidlice před zbraní': 'Two low forks in front of the weapon', 'Široký klín': 'Wide wedge', 'Ocelový klín přes celou šířku – lépe podjede soupeře, +6 g': 'Full-width steel wedge – gets under opponents better, +6 g',
  'Bez klínu': 'No wedge', 'Lehčí, ale soupeř se snadno dostane pod vás, −6 g': 'Lighter, but opponents get under you easily, −6 g', 'Tištěný plast': 'Printed plastic', 'Základní odolnost': 'Basic toughness',
  'TPU boky': 'TPU sides', 'Měkké boky pohltí zásahy z boku, +9 g': 'Soft sides absorb side hits, +9 g', 'Titanový štít': 'Titanium shield', 'Pevná příď, +14 g': 'Solid nose, +14 g',
  'Bez pancíře': 'No armour', 'Lehký a křehký, −8 g': 'Light and fragile, −8 g', 'Gyro asistent': 'Gyro assist', 'Drží směr a dávkuje zatáčení': 'Holds heading and smooths steering',
  'Bez gyra': 'No gyro', 'Čisté ruční řízení – rychlejší otáčení, těžší jízda': 'Pure manual control – faster turning, harder to drive',
  'Rychlost': 'Speed', 'Tlak': 'Push', 'Odolnost': 'Toughness', 'Hotovo': 'Done', 'Stavebnice': 'Kit', 'Postavte si ho': 'Build it',
  /* HUD */
  'Vy': 'You', 'Soupeř': 'Opponent', 'AI': 'AI', 'Hráč 1': 'Player 1', 'Hráč 2': 'Player 2', 'Hráč 1:': 'Player 1:',
  'Zvuk zap.': 'Sound on', 'Zvuk vyp.': 'Sound off', 'Zvuk vypnut': 'Sound off', 'Zvuk zapnut': 'Sound on', 'Zvuk (M)': 'Sound (M)', 'Na start': 'Reset', 'Pauza': 'Pause', 'Pauza (Esc)': 'Pause (Esc)', 'Pozastavit': 'Pause',
  'Přepnout kameru (C)': 'Switch camera (C)', 'Vrátit na start (R)': 'Back to start (R)', 'Soupeř jezdí (T)': 'Opponent drives (T)', 'Soupeř jezdí': 'Opponent drives', 'Soupeř stojí': 'Opponent stands still',
  'Kamera': 'Camera', 'TV přenos': 'TV broadcast', 'Za robotem': 'Chase', 'Shora': 'Top', 'Z robota (FPV)': 'On board (FPV)', 'Z robota': 'On board', 'Rozdělená obrazovka': 'Split screen',
  'kamera ·': 'camera ·', 'zvuk ·': 'sound ·', 'Esc': 'Esc',
  'Nástraha!': 'Hazard!', 'Jáma se otevřela!': 'The pit is open!', 'Jede vzhůru nohama': 'Driving upside down', '· flipper = otočit': '· flipper = self-right', '· zbraň = otočit': '· weapon = self-right',
  '· jeďte a rozhoupejte se': '· drive and rock yourself over', 'Zbraň vypnutá': 'Weapon off', 'Flipper nabíjí': 'Flipper recharging', 'Flipper připraven': 'Flipper ready',
  'Zbraň zaseknutá – znovu zapnout': 'Weapon stalled – switch it on again', 'Vidle nahoře': 'Forks up', 'Kleště nabíjí': 'Clamp recharging', 'Kleště připraveny': 'Clamp ready',
  'Kolo upadlo!': 'Wheel off!', 'Zbraň ohnutá!': 'Weapon bent!', 'Baterie poškozena!': 'Battery damaged!', 'Elektronika otřesena!': 'Electronics shaken!',
  'Trénink': 'Practice', 'Zpátky na start': 'Back to the start', 'flipper (i k převrácení zpět)': 'flipper (also to self-right)', 'roztočení zbraně (zap/vyp)': 'spin up the weapon (on/off)',
  'nebo šipky jízda ·': 'or arrows drive ·', 'kamera': 'camera', 'zvuk': 'sound', 'pauza · funguje i gamepad': 'pause · gamepads work too', 'Mezerník': 'Space',
  'Hlasitost': 'Volume', 'Efekty': 'Effects', 'Prostředí': 'Ambience',
  /* pause, end of match, judges */
  'Zápas stojí': 'Match paused', 'Pokračovat': 'Continue', 'pokračovat': 'continue', 'Od začátku': 'Restart', 'Do menu': 'To menu', 'Menu': 'Menu', 'Znovu': 'Again',
  'Záznam posledních 20 s': 'Replay of the last 20 s', 'Otřesy kamery při zásahu': 'Camera shake on hits', 'Automaticky přehrát záznam K.O.': 'Auto-play the K.O. replay',
  'Konec zápasu': 'End of match', 'Výhra': 'Win', 'Prohra': 'Loss', 'Remíza': 'Draw', 'Vyhrává hráč 1': 'Player 1 wins', 'Vyhrává hráč 2': 'Player 2 wins', 'Vítěz turnaje!': 'Tournament winner!',
  'Konec zápasu · K.O.': 'End of match · K.O.', 'Konec zápasu · rozhodnutí rozhodčích': 'End of match · judges’ decision',
  'Zatím jen ve hře': 'Only in the game so far', 'Stavebnici připravujeme': 'Kit coming soon', 'Bojoví roboti v katalogu': 'Combat robots in the catalogue', 'Dejte mi vědět': 'Notify me',
  'Opakovat K.O.': 'Replay the K.O.', 'Opakovat zásah': 'Replay the hit', 'Další soupeř': 'Next opponent', 'Celý zápas': 'Full match', 'Sdílet výsledek': 'Share the result',
  'Bodování rozhodčích': 'Judges’ scores', 'Poškození': 'Damage', 'Agrese': 'Aggression', 'Kontrola': 'Control',
  'Hráč 1 vytlačil soupeře z arény.': 'Player 1 pushed the opponent out of the arena.', 'Vytlačili jste soupeře z arény.': 'You pushed the opponent out of the arena.',
  'Robot hráče 2 skončil v jámě.': 'Player 2’s robot ended up in the pit.', 'Soupeř skončil v jámě.': 'The opponent ended up in the pit.',
  'Robot hráče 1 skončil v jámě.': 'Player 1’s robot ended up in the pit.', 'Váš robot skončil v jámě.': 'Your robot ended up in the pit.',
  'Robot hráče 1 vypadl z arény.': 'Player 1’s robot fell out of the arena.', 'Váš robot vypadl z arény.': 'Your robot fell out of the arena.',
  'Hráč 1 se 10 s nemohl pohnout.': 'Player 1 couldn’t move for 10 s.', 'Váš robot se 10 s nemohl pohnout.': 'Your robot couldn’t move for 10 s.',
  'Čas vypršel – rozhodčí se neshodli.': 'Time’s up – the judges disagreed.', 'Výhra na body': 'Win on points', 'Odkaz zkopírován do schránky.': 'Link copied to the clipboard.',
  /* replays */
  'Záznam': 'Replay', 'Přehrávač záznamu': 'Replay player', 'zpomaleně': 'slow motion', 'Pozice v záznamu': 'Replay position', 'Předchozí zásah': 'Previous hit', 'Další zásah': 'Next hit',
  'Rychlost přehrávání': 'Playback speed', 'Přepnout kameru': 'Switch camera', 'Sledovaný robot': 'Followed robot', 'Sledovat': 'Follow', 'Zpomalit velké zásahy': 'Slow down big hits',
  'Uložit záznam': 'Save replay', 'Sdílet odkaz': 'Share link', 'Klip 10 s': '10 s clip', 'Zavřít': 'Close', 'Přehrát': 'Play',
  'Režisér': 'Director', 'Volná': 'Free', 'Zásah': 'Hit', 'Převrácení': 'Flip', 'Jáma': 'Pit', 'Mimo arénu': 'Out of the arena', 'Upadlé kolo': 'Lost wheel',
  'Záznam K.O.': 'K.O. replay', 'Opakovaný zásah': 'Hit replay', 'Posledních 20 s': 'Last 20 s', 'Záznam ze souboru': 'Replay from file', 'Záznam z arény 150 g': 'Replay from the 150 g arena',
  'Záznam se nepodařilo přehrát.': 'The replay couldn’t be played.', 'Soubor se nepodařilo načíst.': 'The file couldn’t be loaded.', 'Záznam obsahuje neznámého robota.': 'The replay contains an unknown robot.',
  'Záznam je poškozený (nástrahy).': 'The replay is damaged (hazards).', 'Záznam se nepodařilo uložit.': 'The replay couldn’t be saved.', 'Odkaz zkopírován.': 'Link copied.',
  'Odkaz se nepodařilo vytvořit.': 'The link couldn’t be created.', 'Nahrávám klip…': 'Recording clip…', 'Klip se nepodařilo uložit.': 'The clip couldn’t be saved.',
  'Nahrávání videa tento prohlížeč neumí.': 'This browser can’t record video.', 'Nahrávání klipu selhalo.': 'Clip recording failed.',
  'Poškozený záznam.': 'Damaged replay.', 'Soubor není záznam z arény.': 'The file isn’t an arena replay.', 'Záznam je z novější verze arény.': 'The replay is from a newer version of the arena.',
  'Nepodporovaná frekvence záznamu.': 'Unsupported replay rate.', 'Záznam je prázdný.': 'The replay is empty.', 'Záznam je příliš dlouhý.': 'The replay is too long.',
  'Záznam je po rozbalení příliš velký.': 'The replay is too large when unpacked.', 'Soubor je příliš velký.': 'The file is too large.', 'Tento prohlížeč neumí rozbalit záznam.': 'This browser can’t unpack the replay.',
  /* maps (names, descriptions, floor decals) */
  'Klasická aréna': 'Classic arena', 'CCRL klasika': 'CCRL classic', 'Jáma v rohu a výjezd ve stěně': 'Corner pit and a wall exit',
  'Věrná 1,2m aréna jako na soutěžích: jáma v rohu a výjezd ze severní stěny.': 'A faithful 1.2 m arena like at competitions: a pit in the corner and an exit in the north wall.',
  'Jáma a rampy': 'Pit and ramps', 'Jáma, podlahové flippery a rampy': 'Pit, floor flippers and ramps',
  'Jáma uprostřed, dva podlahové flippery a rampy u stěn. Dobrým zásahem soupeře vyhodíte přes stěnu.': 'A pit in the middle, two floor flippers and ramps along the walls. A good hit throws your opponent over the wall.',
  'Kladivo': 'Hammer', 'Kladivo, pily z podlahy a jáma': 'Hammer, floor saws and a pit',
  'Ocelová aréna s nástrahami: kladivo v rohu, pily vyjíždějící z podlahy a jáma. Kdo se zdržuje u kladiva, dostane ránu.': 'A steel arena with hazards: a hammer in the corner, saws rising from the floor and a pit. Linger by the hammer and you get hit.',
  'Led': 'Ice', 'Kluzký led a dva výjezdy': 'Slippery ice and two exits',
  'Kluziště: uprostřed led, po okraji gumový pás. Roboti kloužou a nesou setrvačnost, ve dvou stěnách jsou výjezdy.': 'An ice rink: ice in the middle, a rubber strip around the edge. Robots slide and carry momentum; two walls have exits.',
  'PROTO ROBOT Praha': 'PROTO ROBOT Prague', 'Noční finále: pily a jáma od 1:00': 'Night final: saws, and a pit from 1:00',
  'Noční finále pražského meetupu: reflektory, publikum, pily ve stěnách a jáma uprostřed, která se otevře v polovině zápasu.': 'The night final of the Prague meetup: spotlights, a crowd, saws in the walls and a pit in the middle that opens halfway through the match.',
  'jáma': 'pit', 'JÁMA': 'PIT', 'výjezd': 'exit', 'výjezdy': 'exits', 'jáma od 1:00': 'pit from 1:00'
};

const patterns = [
  [/^Kritický zásah −(\d+)$/, 'Critical hit −$1'], [/^Zbraň (\d+) %$/, 'Weapon $1 %'], [/^Drží soupeře (\d+) s$/, 'Holding the opponent $1 s'],
  [/^Převrácený (\d+) s$/, 'Flipped $1 s'], [/^Nepojízdný (\d+) s$/, 'Immobile $1 s'], [/^Zásahy (\d+)$/, 'Hits $1'],
  [/^Převrácený (\d+) s · (.+)$/, (m, a, b) => `Flipped ${a} s · ${T('· ' + b).replace(/^· /, '')}`], [/^Nepojízdný (\d+) s · (.+)$/, (m, a, b) => `Immobile ${a} s · ${T('· ' + b).replace(/^· /, '')}`],
  [/^Zásahy (\d+) : (\d+) · čas (.+)$/, 'Hits $1 : $2 · time $3'],
  [/^K\.O\. č\. (\d+)!$/, 'K.O. no. $1!'], [/^Turnaj · zápas (\d+) ze (\d+)$/, 'Tournament · match $1 of $2'], [/^Další soupeř: (.+)$/, (m, a) => `Next opponent: ${T(a)}`],
  [/^Rozhodčí (\d+): (\d+)–(\d+)$/, 'Judge $1: $2–$3'],
  [/^Čas vypršel – rozhodčí (jednomyslně|rozhodnutím 2 : 1) pro (hráče 1|hráče 2|vás|soupeře)\.$/, (m, how, who) =>
    `Time’s up – the judges ${how === 'jednomyslně' ? 'unanimously' : 'by a 2 : 1 decision'} for ${{ 'hráče 1': 'player 1', 'hráče 2': 'player 2', 'vás': 'you', 'soupeře': 'the opponent' }[who]}.`],
  [/^Vítězství v turnaji: (\d+)×$/, 'Tournament wins: $1×'],
  [/^(\d+) g · úpravy: (\d+)$/, '$1 g · upgrades: $2'], [/^(\d+) g · bez úprav$/, '$1 g · no upgrades'],
  [/^Levý joystick jízda · tlačítko vpravo (.+)$/, (m, a) => `Left stick drives · right button ${T(a)}`],
  [/^Garáž · (.+)$/, 'Garage · $1'], [/^Garáž$/, 'Garage'], [/^Překročili byste limit (\d+) g$/, 'You’d exceed the $1 g limit'], [/^Přetíženo o (\d+) g \(limit (\d+) g\)$/, 'Overweight by $1 g (limit $2 g)'],
  [/^Výhra K\.O\. za (.+)$/, 'K.O. win in $1'],
  [/^(Remíza|Výhra K\.O\. za .+|Výhra na body|Prohra): (.+) vs\. (.+) v aréně 150 g na printedrobotics\.cz\. Zkusíte to líp\?$/, (m, v, a, b) => `${T(v)}: ${T(a)} vs. ${T(b)} in the 150 g arena on printedrobotics.cz. Can you do better?`],
  [/^Jáma se otevře za (\d+) s$/, 'The pit opens in $1 s'],
  [/^Rychlost (.+)×$/, (m, a) => `Speed ${dec(a)}×`], [/^Záznam uložen \((\d+) kB\)\.$/, 'Replay saved ($1 kB).'], [/^Klip uložen \((\d+) kB\)\.$/, 'Clip saved ($1 kB).']
];

export default { strings, patterns };

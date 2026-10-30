// Writes the two shells of the ROBOTO ORIGIN sim page: sim/origin/index.html (cs) and en/sim/origin/index.html (en).
// node sim/origin/tools/pages.mjs   (run from the repo root after editing the texts below)
import fs from 'node:fs';

const T = {
  cs: {
    path: 'sim/origin/', up: '../../', other: '../../en/sim/origin/', lang: 'cs',
    title: 'ROBOTO ORIGIN v simulaci – otevřený humanoid v prohlížeči | printedrobotics.cz',
    desc: 'Otevřený humanoid ROBOTO ORIGIN (RoboParty) ve fyzikální simulaci MuJoCo: chůze řízená naučenou politikou, klouby na posuvnících, strčení myší.',
    bar: 'ROBOTO ORIGIN · simulace', back: 'Katalog', stage: '3D simulace humanoidního robota',
    canvas: 'Humanoid ROBOTO ORIGIN na podlaze s mřížkou. Chůze klávesami W A S D nebo joystickem, kliknutím do robota do něj strčíte.',
    hint: 'Táhněte pro otočení pohledu · kolečko pro přiblížení · kliknutím do robota do něj strčíte',
    loading: 'Načítáme simulaci…', loadSub: 'MuJoCo, model robota a naučená politika chůze (≈ 22 MB, při kompresi ≈ 8 MB) · na pomalém připojení to chvíli trvá',
    failK: 'Simulace se nespustila', failH: 'Tenhle prohlížeč simulaci nezvládne.',
    failP: 'Simulace potřebuje WebAssembly a WebGL. Zkuste aktuální Chrome, Firefox, Safari nebo Edge, případně počítač místo telefonu.',
    panel: 'Ovládání', kicker: 'Ukázka · otevřený hardware', h1: 'ROBOTO ORIGIN',
    lead: 'Humanoidní robot od RoboParty: 23 kloubů a konstrukce z frézovaného hliníku. Podle autorů je jako open source zveřejněný celý vývoj: konstrukce, elektronika, trénink i nasazení. V simulaci chodí politika, kterou autoři natrénovali a zveřejnili.',
    showcase: 'Ukázka, ne produkt: díly ani sady k tomuto robotovi neprodáváme. S RoboParty nejsme nijak spojeni.',
    honest: 'Fyzika je přibližná a skutečný robot se chová jinak. Chůzi řídí politika, kterou natrénovala a zveřejnila RoboParty; my ji jen spouštíme v prohlížeči. Doporučujeme počítač s grafickou kartou.',
    ogTitle: 'ROBOTO ORIGIN v simulaci', ogDesc: 'Otevřený humanoid RoboParty chodí v prohlížeči: naučená politika chůze, 23 kloubů, strčení myší.', locale: 'cs_CZ',
    perf: 'Výkon: grafika tohoto zařízení je slabší, stíny jsme vypnuli.', simple: 'Zjednodušený režim (nižší rozlišení, bez mřížky)',
    mode: 'Režim', walk: 'Chůze (naučená politika)', stand: 'Na stojanu (klouby ručně)',
    padLabel: 'Joystick: nahoru vpřed, do stran otáčení',
    tMove: 'Chůze: nahoru vpřed, dolů vzad, do stran krok vlevo a vpravo', touchHud: 'Řídí naučená politika chůze · levý joystick chůze, pravý otáčení', tTurn: 'Otáčení: táhněte vlevo nebo vpravo', tUp: 'Postavit', keys: 'Klávesy: W/S vpřed a vzad · A/D otáčení · Q/E krok do strany · gamepad funguje také',
    shove: 'Strčit', drop: 'Pustit z výšky', standup: 'Postavit', view: 'Pohled', explode: 'Rozložený pohled', pose: 'Výchozí póza',
    joints: 'Klouby (23)', about: 'O simulaci a licence',
    aboutP: `Model, sítě a politika chůze: <a href="https://github.com/Roboparty/roboto_origin">RoboParty roboto_origin</a> (popis robota CERN-OHL-W-2.0, politika a software GPL-3.0). Sítě jsme zjednodušili pro prohlížeč, zbytek je beze změny – <a href="NOTICE.txt">licence, změny a přesná verze</a>. Fyzika <a href="https://mujoco.org/">MuJoCo</a>, politika běží přes ONNX Runtime Web. Nejsme s RoboParty nijak spojeni; ROBOTO ORIGIN a RoboParty jsou jejich označení. Simulace je zjednodušená, skutečný robot se chová jinak.`,
    nojs: 'Simulace potřebuje JavaScript.'
  },
  en: {
    path: 'en/sim/origin/', up: '../../../', other: '../../../sim/origin/', lang: 'en',
    title: 'ROBOTO ORIGIN in simulation – an open humanoid in your browser | printedrobotics.cz',
    desc: 'The open-source ROBOTO ORIGIN humanoid (RoboParty) in a MuJoCo physics simulation: walking driven by its trained policy, joint sliders, push it with a click.',
    bar: 'ROBOTO ORIGIN · simulation', back: 'Catalogue', stage: '3D simulation of a humanoid robot',
    canvas: 'The ROBOTO ORIGIN humanoid on a grid floor. Walk with W A S D or the joystick; click the robot to push it.',
    hint: 'Drag to orbit · scroll to zoom · click the robot to push it',
    loading: 'Loading the simulation…', loadSub: 'MuJoCo, the robot model and the trained walking policy (≈ 22 MB, ≈ 8 MB compressed) · this takes a while on slow connections',
    failK: 'The simulation did not start', failH: 'This browser cannot run the simulation.',
    failP: 'The simulation needs WebAssembly and WebGL. Try a current Chrome, Firefox, Safari or Edge, or a computer instead of a phone.',
    panel: 'Controls', kicker: 'Showcase · open hardware', h1: 'ROBOTO ORIGIN',
    lead: 'A humanoid robot by RoboParty: 23 joints and a machined-aluminium frame. According to its authors the whole development is open source: mechanics, electronics, training and deployment. In the simulation it walks with the policy its authors trained and released.',
    showcase: 'A showcase, not a product: we do not sell parts or kits for this robot. We are not affiliated with RoboParty.',
    honest: 'The physics is approximate and the real robot behaves differently. Walking is driven by the policy RoboParty trained and published; we only run it in the browser. A computer with a graphics card is recommended.',
    ogTitle: 'ROBOTO ORIGIN in simulation', ogDesc: 'RoboParty’s open humanoid walks in your browser: trained walking policy, 23 joints, push it with a click.', locale: 'en_GB',
    perf: 'Performance: this device has weaker graphics, so shadows are off.', simple: 'Simplified mode (lower resolution, no grid)',
    mode: 'Mode', walk: 'Walk (trained policy)', stand: 'On the gantry (joints by hand)',
    padLabel: 'Joystick: up walks forward, sideways turns',
    tMove: 'Walk: up forward, down back, sideways to sidestep', touchHud: 'Walking policy in control · left stick walks, right control turns', tTurn: 'Turn: drag left or right', tUp: 'Stand up', keys: 'Keys: W/S forward and back · A/D turn · Q/E sidestep · a gamepad works too',
    shove: 'Push', drop: 'Drop from height', standup: 'Stand up', view: 'View', explode: 'Exploded view', pose: 'Default pose',
    joints: 'Joints (23)', about: 'About the simulation and licences',
    aboutP: `Model, meshes and walking policy: <a href="https://github.com/Roboparty/roboto_origin">RoboParty roboto_origin</a> (robot description CERN-OHL-W-2.0, policy and software GPL-3.0). We simplified the meshes for the browser; everything else is unchanged – <a href="../../../sim/origin/NOTICE.txt">licences, changes and exact version</a>. Physics by <a href="https://mujoco.org/">MuJoCo</a>; the policy runs on ONNX Runtime Web. We are not affiliated with RoboParty; ROBOTO ORIGIN and RoboParty are their marks. The simulation is simplified; the real robot behaves differently.`,
    nojs: 'The simulation needs JavaScript.'
  }
};

for (const L of ['cs', 'en']) {
  const t = T[L], S = L === 'en' ? T.en.up + 'sim/origin/' : '';
  const html = `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${t.title}</title>
<meta name="description" content="${t.desc}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://printedrobotics.cz/${t.path}">
<link rel="alternate" hreflang="cs" href="https://printedrobotics.cz/sim/origin/">
<link rel="alternate" hreflang="en" href="https://printedrobotics.cz/en/sim/origin/">
<link rel="alternate" hreflang="x-default" href="https://printedrobotics.cz/sim/origin/">
<meta property="og:title" content="${t.ogTitle}">
<meta property="og:description" content="${t.ogDesc}">
<meta property="og:url" content="https://printedrobotics.cz/${t.path}">
<meta property="og:image" content="https://printedrobotics.cz/img/origin_poster.jpg">
<meta property="og:locale" content="${t.locale}">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23E8461E'/%3E%3C/svg%3E">
<link rel="preload" href="${S}../so101/vendor/mujoco/mujoco.wasm" as="fetch" type="application/wasm" crossorigin>
<link rel="modulepreload" href="${t.up}vendor/three/three.module.min.js">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${S}origin.css">
<script type="importmap">{"imports":{"three":"${t.up}vendor/three/three.module.min.js","three/addons/":"${t.up}vendor/three/addons/"}}</script>
</head>
<body>
<header class="bar">
  <div class="brand"><i aria-hidden="true"></i><a href="${t.up}${L === 'en' ? 'en/' : ''}">printedrobotics</a></div>
  <span class="bar-t mono">${t.bar}</span>
  <nav class="lang" aria-label="Jazyk / Language"><a href="${L === 'cs' ? './' : t.other}"${L === 'cs' ? ' aria-current="page"' : ''} lang="cs" hreflang="cs">CZ</a><a href="${L === 'en' ? './' : t.other}"${L === 'en' ? ' aria-current="page"' : ''} lang="en" hreflang="en">EN</a></nav>
</header>
<p class="sr-only" id="sr" role="status" aria-live="polite"></p>
<main class="sim">
  <section class="stage" aria-label="${t.stage}">
    <canvas id="c" aria-label="${t.canvas}"></canvas>
    <div class="hud" id="hud" hidden><span class="hud-dot" id="hud-dot" aria-hidden="true"></span><span id="hud-text"></span></div>
    <p class="hint mono" id="hint" hidden>${t.hint}</p>
    <!-- touch / narrow screens: drive controls on the canvas, in the thumb zone (CSS shows them only there) -->
    <div class="touch" id="touch" data-hud="${t.touchHud}">
      <div class="tpad tpad-move" id="tpad-move" role="img" aria-label="${t.tMove}"><span class="knob" id="tknob-move"></span></div>
      <div class="tpad tpad-turn" id="tpad-turn" role="img" aria-label="${t.tTurn}"><span class="tturn-l" aria-hidden="true">⟲</span><span class="tturn-r" aria-hidden="true">⟳</span><span class="knob" id="tknob-turn"></span></div>
      <button type="button" class="tbtn" id="t-standup">${t.tUp}</button>
    </div>
    <div class="loader" id="loader"><div class="loader-in">
      <p class="mono" role="status">${t.loading}</p>
      <div class="prog" aria-hidden="true"><b id="prog"></b></div>
      <p class="mono muted">${t.loadSub}</p>
    </div></div>
    <div class="fail" id="fail" hidden><div class="fail-in">
      <p class="mono">${t.failK}</p><h2>${t.failH}</h2><p id="fail-msg">${t.failP}</p>
    </div></div>
  </section>
  <aside class="panel" aria-label="${t.panel}">
    <section>
      <p class="mono">${t.kicker}</p>
      <h1>${t.h1}</h1>
      <p class="ink2">${t.lead}</p>
      <p class="note mono-s">${t.showcase}</p>
      <p class="mono-s muted honest">${t.honest}</p>
      <div class="perf" id="perf" hidden><p class="mono-s">${t.perf}</p><label class="chk" id="simple-wrap" hidden><input type="checkbox" id="simple"> ${t.simple}</label></div>
    </section>
    <section aria-labelledby="mode-h">
      <h2 class="mono sec-h" id="mode-h">${t.mode}</h2>
      <div class="seg" role="radiogroup" aria-labelledby="mode-h">
        <label><input type="radio" name="mode" id="mode-walk" value="walk" checked> <span>${t.walk}</span></label>
        <label><input type="radio" name="mode" id="mode-stand" value="stand"> <span>${t.stand}</span></label>
      </div>
      <p class="note mono-s" id="nopolicy" hidden></p>
      <div id="walkbox" class="walkbox">
        <div class="pad" id="pad" role="img" aria-label="${t.padLabel}"><span class="knob" id="knob"></span></div>
        <div class="walk-side">
          <p class="mono-s muted">${t.keys}</p>
          <p class="mono-s cmd" id="cmd" aria-live="off"></p>
        </div>
      </div>
      <div class="row-b">
        <button type="button" class="btn btn-o" id="shove">${t.shove}</button>
        <button type="button" class="btn btn-o" id="drop">${t.drop}</button>
        <button type="button" class="btn btn-o" id="standup">${t.standup}</button>
        <button type="button" class="btn btn-o" id="view">${t.view}</button>
      </div>
      <label class="chk"><input type="checkbox" id="explode"> ${t.explode}</label>
    </section>
    <section aria-labelledby="joints-h">
      <div class="sec-row"><h2 class="mono sec-h" id="joints-h">${t.joints}</h2><button type="button" class="btn btn-o mini" id="pose">${t.pose}</button></div>
      <p class="mono-s muted" id="joints-note"></p>
      <fieldset class="joints" id="joints"><legend class="sr-only">${t.joints}</legend></fieldset>
    </section>
    <details class="about"><summary>${t.about}</summary><p class="mono-s">${t.aboutP}</p></details>
  </aside>
</main>
<noscript><p class="nojs">${t.nojs}</p></noscript>
<script type="module" src="${S}app.js"></script>
</body>
</html>
`;
  fs.mkdirSync(t.path, { recursive: true });
  fs.writeFileSync(t.path + 'index.html', html);
  console.log('wrote', t.path + 'index.html');
}

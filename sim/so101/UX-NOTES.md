# SO-101 sim — UX layer (branch `so101-ux`)

Everything new lives in separate modules; `app.js` and `index.html` only got small, marked hook points so the
merge with the `servo-emulator` branch stays easy. Search for `[ux-hook:` (app.js) and `[ux]` (index.html).

## Hook points

Since the merge of `servo-emulator`, physics/rendering live in `core.js` (`ArmSim`) and the mission page in
`app.js` (`MissionPage`). The UX layer gets one facade (`hostFor()` in src/ux.js, a Proxy) that routes each member
to the page (sliders, demo, HUD, reset) or to the sim (model, data, three.js scene, camera).

| File | Marker | What it does |
|---|---|---|
| app.js `main()` | `[ux-hook:install]` | `import('./src/ux.js').install(page, {THREE, mj, TEST})` in try/catch. If the UX layer fails, the plain slider sim still runs. |
| app.js `MissionPage` ctor | `[ux-hook:pre]` | `sim.onFrame`: `ux.pre(dt)` (planner / IK controller / replay write `d.ctrl`) before the demo tick. |
| app.js `MissionPage` ctor | `[ux-hook:check]` | `sim.onAfter`: mission logic of the UX layer replaces `sim.check()` + `hud()`. |
| app.js `reset()` | `[ux-hook:reset]` | `this.ux.onReset()` – mission layout, controller sync, path cleanup. |
| app.js `startDemo()` | `[ux-hook:demo]` | "Ukázat řešení" runs the planner solution of the current mission. |
| app.js `api()` | `[ux-hook:api]` | `ux.extendApi(api)` adds test hooks to `window.__sim` (?test=1). |
| core.js `loop()` | `[ux-hook:render]` | `sim.onRender(dt)` (set by the UX layer) draws main view + wrist PiP; default is `renderer.render`. |
| index.html head | `[ux]` | `src/ux.css` |
| index.html panel | `[ux]` | `<div id="ux-mode">` before `#joints`, `<div id="ux-teach">` after `.row-b` |

The setup wizard (`nastaveni/`) uses core.js without the UX layer; the extra scene bodies are parked off-table
there and invisible (group 3), so it is unaffected.

Everything else (stage toolbar, wrist-cam frame, toasts, dialogs, onboarding) is created by JS inside `.stage`
/ `body`. Existing ids (`#joints`, `#home`, `#reset`, `#demo`, `#win`, `#hud`, `.mission h1`) are reused, not renamed.

Who writes `d.ctrl`: joint sliders (app.js), scripted demo (app.js, only without UX), `ArmController`
(src/controller.js, only while `active`), `Teach` replay. Slider `input` cancels controller + replay. A transport
layer that mirrors a real servo bus should read `d.ctrl` / `d.qpos` and does not need to know about the UX layer;
if it *drives* the arm, call `app.ux.ctl.cancel()` first (same as the sliders).

## Modules

- `src/kin.js` – kinematic chain read from the compiled MjModel, FK, damped-least-squares IK with a null-space
  "approach pitch" task, joint limits, `solveAuto` (position first, gripper as vertical as possible).
- `src/controller.js` – IK target following (rate-limited, smooth), planner: pick / place (closed-loop release
  correction) / paths / pushes, reachability check for previews. DOM-free.
- `src/world.js` – mission objects (cube, cube_b, ball, bowl, bowl2, goal); unused ones are parked on the hidden floor.
- `src/missions.js` – 5 missions (layout, check, stars, automatic solution) + `MissionRunner`. DOM-free.
- `src/ux.js` – glue: hooks, click-to-pick, keyboard, win flow, test API.
- `src/ui/*` – gizmo + ghost + path preview + pen (gizmo.js), cameras + wrist PiP (cameras.js), teach & replay +
  JSON export (teach.js), panel DOM (panel.js), onboarding, sound/haptics (audio.js), confetti (fx.js),
  extra meshes + studio lighting (extras.js), localStorage wrapper (store.js).
- `src/ui/hidetail.js` – lazy high-detail visuals: `model/visual/so101_visual.glb` (all 14 original Menagerie
  STLs, 325 020 triangles, meshopt + 14-bit quantization, **0.98 MB**, 0.6 MB gzipped) is loaded after start
  (idle callback) and swapped in for the decimated `.msh` geometry, which stays the physics/collision mesh.
  Raw STL coordinates are mapped into MuJoCo's processed mesh frame with `mesh_pos` / `mesh_quat`.
  Quality setting "Detail modelu: Vysoký / Úsporný" (localStorage `pr-sim-quality`, `?detail=low|high`);
  default low on Save-Data / 2G and on touch devices reporting < 6 GB `deviceMemory` or none (iOS/Safari).
  Rebuild with `tools/stl-to-glb.mjs` (instructions in the file header).
- `src/ui/explode.js` – "Z čeho se SO-101 skládá": exploded view (slider), Czech part names on hover/tap,
  printed vs. bought legend, assembly animation in the order of the LeRobot SO-101 guide (Joint 1 … Gripper),
  CTA "Tyto díly vám vytiskneme" → ../../sada/so101/.
- `model/scene.xml` – new bodies `cube_b`, `ball` (free), `bowl` / `bowl2` / `goal` (mocap). Their geoms are in
  group 3 so app.js does not draw them; `src/ui/extras.js` does.

## Tests

- `node --test sim/so101/tests/*.test.mjs` – IK/FK against MuJoCo (node + vendored WASM), each mission solved by
  its plan in physics, drag-follow, random click-to-pick.
- `sim/so101/tests/e2e.cjs` – Playwright (Chromium, SwiftShader): smart-move drag, click-to-pick, every mission,
  record/replay/export, cameras, screenshots desktop 1280×800 and phone 390×844.

## URL parameters

`?mise=stack` (bowl, stack, sort, ball, trace) opens a mission directly and skips onboarding;
`?onboard=1` forces the tutorial; `?test=1` exposes `window.__sim`.

## Usability round 1 (branch `so101-flows`)

Findings: scratchpad usability report (P0/P1/P2). Changes:

- **Tap = pick, drag = move** (`gizmo.js`): pressing a gizmo handle only starts a drag after > 6 px; a tap picks the
  object under it; a closer object wins outright. Lower height-arrow hit area shrunk. No time limit on clicks.
- **Guided first task** (`onboarding.js`): click cube → click bowl → win → "Teď ručně" (drag) → height/wrist/gripper.
  Phones: the guide is a strip under the stage (`.ux-under`), desktop bubble avoids covering cube/bowl/target.
- **Gripper-aware HUD** (`missions.js graspHint`), pick missions start with the gripper open (`openStart`).
- **Poradit** in the HUD after 20 s; Domů/Znovu/Ukázat řešení moved under the mode switch; phones get a sticky
  row under the stage: HUD strip + Chapadlo · Domů · Poradit. Key **G** = gripper (besides Space).
- "Ukázat řešení" / replay wins never count as the visitor's stars or record (`runner.assisted`).
- Teach: demo persisted in localStorage, Oříznout (idle start/end), Smazat, Nahrát JSON (import of the export,
  which now carries a `printedrobotics.snapshot`), **share link** `#ukazka=<gzip base64url>`.
- Loading text with size, %, time left and cache note (`app.js loadingCopy`, marked `[ux-hook:loading]`).
- Exploded view hides HUD/timer/toolbar/objects, frames the exploded parts; on phones the card moves into the panel.
  "Z čeho se SO-101 skládá →" link under the mission.
- Table floor: targets clamp at 9 mm with a one-off toast; "Mimo dosah" HUD text; joint sliders show "(doraz)" and
  `aria-valuetext`; canvas focusable with a description; toolbar labels; per-mission tip and camera (`tip`, `look`).

### Round 1b (owner requests)
- **Grab any link** (`src/ui/links.js`): hover/touch highlights the link + ring on its joint axis with the angle;
  drag rotates only that joint (pointer projected on the rotation plane, clamped, red "doraz" feedback);
  double-tap a link = that joint home; tap on the jaws = open/close (same command as the button), drag the moving
  jaw = opening. Order of precedence on press: IK-ball handles → objects (tap = pick) → links → empty space = orbit.
  Keys 1–6 select a joint (Shift+1–5 = missions), ←/→ rotate, Esc deselects, Tab on the canvas cycles joints.
- **Drawing mission** (`src/draw.js`): drag on the paper (or the ball) moves the marker in the paper plane at a fixed
  height; P = pen up/down (phones: the first button under the stage); magnet "Pomoc 0/1/2" toward the template;
  speed-limited; floor cursor green/orange/red by deviation; steep top-down camera with a "3D pohled" toggle;
  K = "Nakreslit prstem" (finger trace → planner). Scoring retuned (85 % coverage, 9 mm hit, 3 ★ < 60 s & < 2.5 mm).
- **Win card** is a 2-column grid that never overflows (tests/win-layout.cjs: tablets, phones, 320–1366 px sweep).

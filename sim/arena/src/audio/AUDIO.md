# Arena audio

All sound is synthesised at start-up (`bank.js` + `synth.js`, seeded, deterministic). No audio files,
nothing downloaded, nothing to license. `core.js` and `synth.js` are shared verbatim with
`sim/so101/src/audio/` — keep both copies identical.

## Graph

```
one-shots (pool of 6, priority stealing, per-key cooldown, ±1.2 dB / ±5 % pitch variation)
loops (per robot: gear motor [+ spinner hum + blade whoosh] -> one shared panner; scrape; room tone)
  -> bus gain: sfx -> comp | motors -> comp | amb -> duck | ui
  -> master gain -> limiter (-4 dB, 20:1, 1 ms) -> soft clip (linear below 0.8) -> out 0.9
```

Node budget: 11 fixed graph nodes; 15 persistent voice nodes (spinner robot 7, plain robot 3, scrape 3,
ambience 2); one-shots add 2 (3 when panned off-centre) each, typically 1–3 at once (~20–24 voice
nodes in a fight). `update`/`motor()` allocate nothing per frame; parameter moves below a threshold are skipped.

The AudioContext is created lazily and resumed only from a user gesture (`sfx.unlock()`, called by
main.js on pointerdown / buttons); a 1-sample silent buffer is played inside the gesture for iOS.
It is suspended while the tab is hidden.

## Hooks (main.js -> `sfx` in `sfx.js`)

| call | when |
|---|---|
| `sfx.unlock()` | any user gesture (already wired on pointerdown, Start, menu buttons) |
| `sfx.listen(camera)` | once per frame before `motor()`: camera -> distance gain + stereo pan |
| `sfx.motor(id, level, spin, robot)` | per frame per robot (id 1 / 2). `level` 0 outside the fight; `robot.drive.wheelOmega/current` give pitch and load |
| `sfx.stopMotors()` | pause, menu, round end |
| `sfx.hit(energy, spinner, pos)` | weapon contact, energy 0..1 (light / mid / heavy tiers; ducks ambience) |
| `sfx.wall(energy, pos)` | robot against wall / hazard strike |
| `sfx.flip(robot)` / `sfx.grab(robot)` | flipper / lifter fire, grabber clamp |
| `sfx.fall()` / `sfx.pitOpen()` | robot out / into pit, pit trapdoor |
| `sfx.beep(final)` / `sfx.buzzer()` / `sfx.jingle(win)` | countdown, round end, result sting |
| `sfx.crowd(e)` / `sfx.click()` | crowd reaction (rate-limited), UI click |
| `sfx.setMuted(b)` / `sfx.setLevels({master, sfx, amb})` | persisted via `ui/store.js` (`muted`, `audio`; try/catch) |

Replays: call `sfx.hit(e, true, p)` from `replay.onEvent` (already wired); other replay events can call the
same functions. Sliders (master / effects / ambience) are injected into `#pause` by `settings.js`.

## Verification

Offline renders (OfflineAudioContext in headless Chromium, `new ArenaAudio({ context })`, every method
takes an optional time argument) — 20 s match mix: peak −4.6 dBFS, −22 LUFS integrated, no clipping.

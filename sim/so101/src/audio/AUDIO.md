# SO-101 audio

Procedural (no files). `core.js` and `synth.js` are shared verbatim with `sim/arena/src/audio/`
(see `sim/arena/src/audio/AUDIO.md` for the graph: buses -> compressors -> limiter -> soft clip).
Buses here: `motors` (six STS3215 servo loops, pitch/level from each joint's speed), `sfx`
(gripper move / squeeze, object taps), `ui` (tick, error, success chime). ~12 persistent voice nodes,
6 one-shot slots; no per-frame allocation.

Off by default. Toggle: toolbar `#ux-sound` / key S -> `ux.setSound(on)`; a volume slider appears under
the button while sound is on. Preference persisted in `store` (`sound`, `soundVol`; try/catch).
The context resumes on the first gesture after sound is enabled (iOS-safe).

## Hooks (`ux.sound`, class `Sound` in `sound.js`)

| call | when |
|---|---|
| `update(speed)` | per frame (reads `ux.d.qvel` per joint, free-object velocities for taps) |
| `grip(open)` | gripper command |
| `grasp()` | an object becomes held |
| `error()` / `success()` | mission fail / mission complete |
| `blip()` | soft UI tick |
| `set(on)` / `setVolume(v)` | settings |

Offline: `new Sound(ux, { context: offlineCtx })`; every method takes an optional time argument.

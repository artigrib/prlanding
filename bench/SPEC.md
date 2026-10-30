# PR-Bench v0 — specification

PR-Bench measures how AI models do **physical robot tasks** in the printedrobotics.cz simulators, the same way for
every model, and turns the results into a public leaderboard (`/bench/`, draft) and content (replays, side-by-side videos).

Status: v0 = this spec + the CONTROL harness, runnable with mock models (CI). Real runs: later, on the VPS only.

## Tracks

| Track | What the model does | Where |
|---|---|---|
| **CONTROL** | drives a simulated SO-101 arm through our tool API | `bench/control/`, `bench/run.mjs` |
| **DESIGN** | designs a printable part with the CAD agent (run_cad sandbox, checks, MuJoCo fit) | delegated to `backend/forge/eval` (`node backend/forge/eval/run.mjs --model <id> --yes`); its graders and tasks live there, its spend counts against `FORGE_DAILY_USD` |
| later | SVRN arena, ROBOTO ORIGIN / Go2 | see [Multi-robot plan](#multi-robot-plan) |

## CONTROL track

### Tools (identical for every model)

The tool surface is the MCP bridge's (`backend/bridge/src/schemas.ts`), executed by the page's own agent API
(`sim/so101/src/agent/sim-api.js`) in-process, headless (MuJoCo WASM in Node, `bench/control/sim.mjs`). Same safety
governor as the browser tab: joint limits, speed cap, workspace box, refused motions never move.

`bench/control/gen-tools.mjs` translates the bridge's JSON Schemas (`backend/bridge-client/schemas.js`) and fixed
descriptions into OpenAI-style function tools (`bench/control/tools.json`, generated; a unit test fails when stale).
Relay-only fields (`session`, `request_id`, `preempt`) are dropped.

Exposed: `get_state, get_scene, move_joints, move_to, run_trajectory, set_gripper, home, stop, check_mission,
reset_scene, snapshot` (multimodal models only) + harness tool `task_complete`. `start_mission`/`list_missions` are not
exposed: the harness starts the task's mission, so a model cannot switch to an easier one.

Tool results are JSON text (`{"ok":true,...}` or `{"ok":false,"error":{code,message,retryable,hint?,details?}}`, the
bridge's error texts). Snapshot images follow as a user message with `image_url` parts.

### Fairness rules

1. Identical system prompt (`tasks.mjs SYSTEM_PROMPT`), task prompt and tool schemas for all models; fixed tool order.
2. Temperature 0 (`agent.mjs TEMPERATURE`), streaming off, provider `seed` = episode seed (best effort).
3. N seeds per task (default 3). Public seed 0 = the mission's authored layout, seeds 1.. = small jitter.
4. Per-episode budget (`agent.mjs BUDGET`): 40 model turns, 8 tool calls per turn, 900 s wall, 400k tokens,
   2048 output tokens per turn, sim time 180 s (plain scene) / 300 s (object scene) / 120 s (behaviour).
   After the episode the sim runs 2 s more (released objects settle) before grading.
5. Vision only via `snapshot`, only for models whose OpenRouter metadata lists image input (`--vision off` forces text).
   v0 snapshot = a schematic top/side render (`snapshot.mjs`), identical for all; photoreal renders (headless
   Chromium) are v1. Text-only and multimodal models are reported separately.
6. Pinned model ids: the requested id, the `model` the provider reports (`served_models`) and the run date are stored.
7. No task-specific tuning per model. A model that answers without a tool call ends its episode.

### Tasks v0 (public set: 12)

| id | scene | success (machine-checked) |
|---|---|---|
| m01-bowl … m05-trace | plain | mission checker in `sim/so101/src/missions.js` (01 bowl, 02 stack, 03 sort, 04 ball, 05 trace) |
| m06-line … m10-lab | objects | mission checker (06 line, 07 breakfast, 08 tidy, 09 workshop, 10 lab) |
| b01-wave | plain, empty | wave N times (public N = 3): swings of wrist_flex/wrist_roll ≥ 20° with the jaw tip ≥ 200 mm up; success = swings within 2N ± 1 |
| b02-square | plain, empty | square in the air (public: centre 250, 0 mm, z 100 mm, side 100 mm): coverage of the outline ≥ 0.9 (checkpoints every 5 mm hit within 8 mm) and mean error ≤ 6 mm |

Mission success is latched: the checker reported a win during the episode (each checker already demands the result
holds still for 0.5–0.6 s). Progress (0..1) comes from the checker (`progress` of sort/trace missions), else 0.5 if it
reports a partial `ok`, else 0.

### Hidden set

Same tasks; layouts jittered ±35 mm / any yaw (fixtures ±10°), new behaviour parameters (waves 2–4; square centre,
size, height, rotation). Variant parameters = HMAC-SHA256(`BENCH_HIDDEN_SECRET`, `task:seed`). The secret lives only on
the VPS (env), never in the repo, logs or results; results carry a 12-hex `variant_tag`. Hidden episode logs contain
the concrete prompts and stay in the gitignored run directory on the VPS. Rotate the secret per published season.

### Metrics (per episode, `results.json`)

success, progress, steps (model turns), tool calls, errors, invalid calls (unknown tool / bad JSON / schema), safety
violations (refused `OUT_OF_LIMITS` + `WORKSPACE_VIOLATION`), objects that fell off the table, sim time, wall time,
tokens in/out, $ (OpenRouter `usage.cost`; else estimated from `/models` pricing, flagged `estimate`), end reason.

### Score (`score.mjs`, `prbench-score@1`)

```
episode points = max(0, 100 × (0.85·S + 0.15·P) − 5 × min(V, 4))   S success 0/1, P progress, V safety violations
task score     = mean episode points over seeds
overall        = mean task score over all tasks (equal weight; a task without episodes counts 0)
```
Cost, tokens, steps and time are shown beside the score, never folded into it (plus cost per success).

### Outputs

`<out>/results.json` (`prbench-results@1`), `<out>/summary.md`, `<out>/episodes/<model>__<task>__s<seed>.json`
(`prbench-episode@1`: messages without images or secrets, tool calls with args/result codes/timing, usage) and
`<out>/replays/*.json` in the sim's demo format (`printedrobotics.cz/so101-sim-demo@1`, `teach.js` import; 30 fps,
start-scene snapshot, jaw-tip path in `printedrobotics.bench`) for side-by-side videos. Default `<out>` = `bench/runs/<run id>` (gitignored).

### Runner

```
node bench/run.mjs --models a/b,c/d --tasks public|hidden|id,id --seeds 3 --max-usd 5 [--vision auto|off] [--out DIR]
```
Refuses without a positive `--max-usd`; stops before the next model call when spent + 1.5 × last call ≥ cap (exit 3).
Refuses real models in CI or without `OPENROUTER_API_KEY`. Key from env only, sent only in the Authorization header,
never printed or written. Base URL from env `OPENROUTER_BASE_URL` (https). Prints fixed `bench: ...` lines only.
Mock models (`mock/solve-bowl`, `mock/fail`, `mock/wave`, `mock/square`, `mock/idle`) need no key or network.

On the VPS: `OPENROUTER_API_KEY` comes from the secret `OPENROUTER_SECRET`; run inside the deployed checkout, e.g.
`OPENROUTER_API_KEY=… node bench/run.mjs --models <ids> --tasks public --seeds 3 --max-usd 20`.
Publish a run by copying a curated `results.json` (no `episodes` for hidden runs) to `bench/results/` and pointing the
page's `data-src` at it. `bench/results/sample.json` = mock data (`--sample`), labelled on the page.

### Tests

`node --test bench/tests/*.test.mjs` (CI job `bench-mock`, no network, no keys): tool translation, variants,
graders, score, client (fake fetch), runner guards, $ cap, mock e2e (M01 solved, failure counted, deterministic,
key never leaks). `/bench/` + `/en/bench/`: smoke, smoke-en, axe.

## Multi-robot plan

- **SVRN arena (later track ARENA)** needs an arena agent API mirroring sim-api: `get_state` (pose, heading, velocity,
  weapon state, HP), `get_arena` (walls, hazards, opponent pose), `drive` {throttle −1..1, turn −1..1, duration_s}
  (rate-limited, time-stepped), `weapon` {on, duration_s}, `stop`, `snapshot`. Tasks: drive to a marker, push a block
  into a zone, survive N s vs a scripted bot, win vs a scripted bot. Graded from the arena's physics state; replays via
  the arena replay codec (`sim/arena/src/replay/codec.js`). Needs a headless arena stepper in Node first.
- **ROBOTO ORIGIN / Unitree Go2 (later track LOCOMOTION)**: high-level commands only (`walk` {vx, vy, yaw_rate,
  duration_s}, `stand`, `sit`, `get_state`, `get_scene`) on top of a learned/scripted gait controller; tasks: reach
  waypoints, follow a path, step over an obstacle, fall rate. The model never commands joints.
- Each new track keeps the rules above: generated tool schemas, fixed budgets, mock policies in CI, hidden variants.

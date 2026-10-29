# bridge-client: connect a simulation tab to the MCP relay

This folder holds plain ES modules with no dependencies and no build step. A simulation page
imports them so that an MCP client (Claude Code etc.) can drive it through
`wss://relay.printedrobotics.cz/tab`. The user-facing docs are in [`docs/mcp.md`](../../docs/mcp.md).

| File | Purpose |
|---|---|
| `agent-bridge.js` | `createAgentBridge({url, handler, ui})`: relay link, pairing, re-validation, motion policy, heartbeat. |
| `panel.js` | `mountPanel(el, {url, handler})`: an optional default UI (Connect, code, Allow/Deny, Disconnect). |
| `schemas.js` | Generated tool schemas. **Do not edit.** Run `npm run schemas` in `backend/bridge`. |
| `validate.js` | A small JSON Schema validator used on every relayed call. |
| `mock-handler.js` | A kinematic mock arm. It is the reference handler, and the tests use it. |
| `adapters/so101-testhook.js` | Adapter for today's `sim/so101/app.js` (`window.__sim`, `?test=1`). |
| `test/mock-page.html` | The page the end-to-end test opens. |

## Wiring it into the sim page

```js
// lazy: load nothing until the user asks for it
document.getElementById('ai-btn').addEventListener('click', async () => {
  const { mountPanel } = await import('/backend/bridge-client/panel.js');
  const { createTestHookHandler } = await import('/backend/bridge-client/adapters/so101-testhook.js');
  const bridge = mountPanel(document.getElementById('ai-panel'), {
    url: 'wss://relay.printedrobotics.cz/tab',
    handler: createTestHookHandler(simApi),   // simApi = what app.js exposes as window.__sim today
  });
  bridge.connect();
}, { once: true });
```

The folder can also be copied next to the sim (for example `sim/so101/agent/`). It has no other
dependencies. Today `app.js` creates `window.__sim` only with `?test=1`, so the sim must expose
the same object without the flag. Making `api()` always available, or passing the `Sim` instance
to the adapter, is enough. To build your own UI instead of `panel.js`, use `createAgentBridge`
and these `ui` hooks:

| Hook | When it fires |
|---|---|
| `onState({state, clientName})` | `state` changes. `state` is one of `idle`, `connecting`, `waiting`, `pairing`, `paired` or `offline`. |
| `onCode({code, expiresAt})` | A new pairing code arrives. Show it large, as `XXXX-XXXX`. |
| `onPairRequest({clientName, expiresAt, allow, deny})` | A client wants control. Show an Allow/Deny prompt. Without this hook the bridge **denies**. |
| `onPairCancel()` | The request expired or was withdrawn. |
| `onPaired({clientName})`, `onUnpaired({reason})` | A session starts or ends. |
| `onActivity({tool, phase, ok, code})` | Each tool call starts or ends. Use it to show an "AI is moving the arm" indicator. |

Bridge methods: `connect()`, `disconnect()` (drops the link), `revoke()` (ends the AI session and
issues a new code), `rotateCode()`, plus `state`, `code` and `clientName`. Render all relay data
with `textContent`, never as HTML.

## Handler interface (implemented by the sim)

Every method may be `async`. Motion methods get `{ signal }` (an `AbortSignal`). When it aborts,
stop the motion, hold the pose, and resolve with `status: "stopped"` or `"preempted"`. To return
an error, throw `new BridgeError(code, details)` (import it from `agent-bridge.js`). `details`
may contain numbers, booleans and short identifiers only.

Arguments arrive already validated against `schemas.js` and use the API units: degrees, percent
open, millimetres, seconds. The handler converts to the sim's radians/metres. Never clamp silently:
throw `OUT_OF_LIMITS` with `{joint, value_deg, min_deg, max_deg}`.

| Tool | Handler method | Returns (plus an optional `meta: {mode, safety, sim_time_s}`) |
|---|---|---|
| — | `info()` | `{views: [...], missions: [...]}`, the capabilities announced at hello |
| `get_state` | `getState()` | `JointState` + `mission: {id, state}` |
| `get_scene` | `getScene({include})` | `{robot: JointState, objects: [{id, kind, pose: {x_mm, y_mm, z_mm}}], mission, safety, limits}` |
| `move_joints` | `moveJoints({joints_deg, gripper_pct, relative, duration_s}, {signal})` | `MotionResult` |
| `move_to` | `moveTo({pose, gripper_pct, duration_s}, {signal})` | `MotionResult` + `ik: {joints_deg, pitch_deg_used, position_error_mm}` |
| `run_trajectory` | `runTrajectory({waypoints}, {signal})` | `MotionResult` + `waypoints`, `segment_durations_s` |
| `set_gripper` | `setGripper({gripper_pct, effort_pct, duration_s}, {signal})` | `MotionResult` (`"open"` = 70 %, `"close"` = 0 %) |
| `home` | `home({pose, duration_s}, {signal})` | `MotionResult` |
| `stop` | `stop()` | `{status: "held", final: JointState}` |
| `snapshot` | `snapshot({view, width})` | `{blob \| dataUrl \| data+mimeType, view, width, height, sim_time_s}` (JPEG or PNG) |
| `list_missions` | `listMissions()` | `{missions: [{id}]}`. The server adds the titles. |
| `start_mission` | `startMission({mission_id})` | `{mission: {id, state, elapsed_s}}` |
| `check_mission` | `checkMission()` | `{mission: {id, state, elapsed_s, ...numbers}}` |
| `reset_scene` | `resetScene()` | `{robot: JointState}` |
| — | `onLinkLost(reason)` | Called when the relay link or the session drops. Hold the pose. |

- `JointState`: `{joints_deg: {shoulder_pan, …, wrist_roll}, gripper_pct, goal_deg, goal_gripper_pct, tool: {x_mm, y_mm, z_mm, pitch_deg?}, moving, safety}`.
- `MotionResult`: `{motion_id, status: "completed"|"stopped"|"preempted"|"held", planned_duration_s, elapsed_s, time_stretched_by?, final: JointState}`.

The bridge handles these, so the handler does not have to:

- Schema re-validation.
- `BUSY` for a second motion, or aborting the running motion when `preempt` is set.
- Deadlines (`TIMEOUT`, then `stop()`).
- `cancel` from the client.
- Calling `stop()` and `onLinkLost()` when the link drops.
- Real arm only, with `createAgentBridge({ ..., localDeadmanMs: REAL_DEADMAN_MS })`: a local
  deadman independent of the relay's `hb`. The tab pings every 250 ms; when nothing has arrived for
  1 s it aborts the motion, calls `stop()` (hold) and `onLinkLost('deadman')`, answers the aborted call
  with `CANCELLED {reason: "deadman"}` and fires the UI hook `onDeadman({tripped, silentMs})`
  (again with `tripped: false` when the link speaks). The aborted motion is never resumed. Server semantics are
  unchanged (the relay still drops a silent tab after `hb` × 3).
- Converting the snapshot blob to base64.
- Adding `meta.backend = "sim"`.

**Errors to use:** `OUT_OF_LIMITS`, `UNREACHABLE`, `IK_NO_SOLUTION`, `ESTOP_ACTIVE` (STOP latched in
the page), `TAB_HIDDEN` (only for a page that cannot run in a background tab; the SO-101 sim keeps running there while an AI is linked and never sends it), `RENDER_UNAVAILABLE`,
`UNKNOWN_MISSION`, `NOT_SUPPORTED`, `COLLISION_DETECTED`, `WORKSPACE_VIOLATION`. Any other code
reaches the agent as `TAB_ERROR`. Free-text strings in results are dropped by the server.

### Mapping to today's sim (`main`, `window.__sim`)

`adapters/so101-testhook.js` maps the interface onto the hook as follows:

- **`setTargets(q_rad[6])`** drives motion. The adapter calls it every 16 ms with a smoothstep
  interpolation, the same profile as `tickDemo`.
- **State** is read from `_app.d`: `qpos` (via `jnt_qposadr`), `ctrl`, `site_xpos[gripperframe]`,
  `xpos[cube|bowl]`.
- **Limits** come from `_app.range`.
- **Gripper %** is `(q − lo) / (hi − lo)`, matching the slider.
- **`reset()`** serves `reset_scene` and `start_mission("bowl")`. `won` drives `check_mission`.
- **`snapshot`** renders `_app.scene` with its own camera into the WebGL canvas and copies it to a
  2D canvas in the same task, so `preserveDrawingBuffer: false` is fine. It then restores the
  user's view.
- **`move_to`** returns `NOT_SUPPORTED`, because `main` has no IK.
- **`{advance: true}`** steps physics with `advance()` from the motion loop. This keeps headless
  tests deterministic.

### Mapping to `so101-ux` (`window.so101`, later)

That branch adds `ArmController` (IK + planner), `MissionRunner` and five missions. The adapter
there should stay a thin file:

- `moveTo` maps to the controller's IK (`kin.solveAuto`) with mm → m and pitch in degrees.
- Motions call `controller.cancel()` first and are cancelled by the `signal`.
- `listMissions`, `startMission` and `checkMission` map to `MISSIONS` and `MissionRunner.result`.
- The server knows the ids `bowl`, `stack`, `sort`, `ball`, `trace` and the object missions `line`, `breakfast`, `tidy`, `workshop`, `lab`. A new mission id
  needs an entry in `MISSIONS` in `backend/bridge/src/schemas.ts`.

# Controlling the SO-101 simulation from Claude Code (MCP)

The SO-101 browser simulation on printedrobotics.cz can be driven by Claude Code or any other
MCP client that supports remote (Streamable HTTP) servers. The simulation keeps running in your
browser tab. Our server only relays messages between the tab and the MCP client. It stores nothing.

Status: MVP, simulation only. No tool can move a real robot arm.

## Connect in four steps

1. Add the server once:

   ```sh
   claude mcp add --transport http so101 https://mcp.printedrobotics.cz/mcp
   ```

   No login or API key is needed. Other MCP clients use the same URL as a "remote MCP server"
   (claude.ai: *Settings → Connectors → Add custom connector*, no authentication).
2. Open the simulation at <https://printedrobotics.cz/sim/so101/> and click **Připojit AI asistenta**
   (Connect AI). The panel shows an 8-character code, for example `BCDF-GHJK`.
3. Tell Claude: *"Connect to the SO-101 simulation, code BCDF-GHJK."*
4. The tab asks whether *Claude Code wants to control this simulation*. Click **Povolit** (Allow).

Then ask in plain words, for example *"Pick up the cube and put it in the bowl"* or
*"Turn the base 30° to the left and show me a picture."*

**Disconnect.** Click **Odpojit AI** (Disconnect AI) in the panel, or close the tab. Claude's next
call fails with a clear message. To reconnect, read Claude a fresh code.

## Tools

Every tool except `connect` takes the `session` value that `connect` returns. Units are part of
the field names: degrees (`_deg`), percent open (`_pct`), millimetres (`_mm`), seconds (`_s`).
Positions use the robot base frame: x forward, y left, z up, origin at the base on the table top.

| Tool | What it does | Main arguments |
|---|---|---|
| `connect` | Pair with the open simulation (the user must click Allow) | `code` |
| `get_state` | Joint angles, gripper, jaw-tip position, moving flag, safety and mission state | — |
| `get_scene` | Robot, objects (cube, bowl) with poses in mm, mission, safety, limits | `include[]` |
| `move_joints` | Smooth joint move; waits until finished | `joints_deg{…}`, `gripper_pct`, `relative`, `duration_s`, `preempt`, `request_id` |
| `move_to` | Move the jaw tip to a point (in-page IK) | `pose{x_mm,y_mm,z_mm,pitch_deg,roll_deg}`, `gripper_pct`, `duration_s` |
| `set_gripper` | Open or close the gripper | `gripper_pct` (0–100, `"open"`, `"close"`), `effort_pct` |
| `home` | Go to the home pose (or `zero`) | `pose`, `duration_s` |
| `stop` | Stop now and hold the pose. A software stop, not an emergency stop | — |
| `snapshot` | JPEG camera image | `view` (`overview`/`top`/`side`, plus `wrist` once the sim supports it), `width` (320/512/768) |
| `list_missions` | Missions this simulation offers | — |
| `start_mission` | Reset the scene and start a mission | `mission_id` |
| `check_mission` | Mission state: `idle`, `running`, `success` or `failed` | — |
| `reset_scene` | Reset the arm and the objects | — |

Joint ranges (degrees): `shoulder_pan` ±110, `shoulder_lift` ±100, `elbow_flex` ±96.8,
`wrist_flex` ±95, `wrist_roll` −157.2…162.8. The gripper goes from 0 (closed) to 100 % open.

Errors come back as tool results with `isError: true` and a code the model can act on.
`OUT_OF_LIMITS` means a target was outside the range; the arm never clamps silently and nothing
moves. The codes are:

- `BUSY`: another motion is running. Wait, call `stop`, or pass `preempt: true`.
- `TAB_GONE`: the tab was closed, the user disconnected, or the link dropped.
- `ESTOP_ACTIVE`: STOP was pressed in the page. Only the user can release it.
- `PAIRING_FAILED` / `PAIRING_DENIED`: wrong or expired code, or the user did not click Allow.
- `RATE_LIMITED`: too many calls. `details.retry_after_ms` says how long to wait.

A `request_id` (any short string) makes a motion call safe to retry. A repeat with the same id
within 120 s returns the first result and does not move the arm again.

## Safety and privacy

- **The browser tab is the only safety authority.** It checks every call again against the same
  schemas and enforces limits, motion order (one motion at a time) and timeouts. A STOP latched in
  the page cannot be released over MCP. The server is only a switchboard.
- **Nothing connects without a person.** A pairing code is not enough on its own: someone at the
  tab must click Allow. Codes expire after 10 minutes and work once. Five wrong tries burn a code,
  and a Deny burns it at once.
- **The session is tied to the tab.** The session handle (128-bit random) is valid only while that
  tab stays open and paired. It expires after 2 h idle (8 h at most).
- **Lost link means stop.** The tab and the server exchange heartbeats. If the link drops, the
  tab stops any motion and holds the pose. Calls in flight fail at once instead of hanging.
- **Data only, no prose.** The server forwards only numbers, booleans and short identifiers from
  the tab. Mission titles and all descriptions come from server code. This keeps text injected
  into a page from reaching the model as instructions. No raw servo or register commands exist.
- **No data at rest.** Pairing state lives in memory only. Logs contain event names and counts,
  never codes, session handles, IP addresses, arguments or images. Images pass through and are
  never stored.
- Claude Code asks before each tool call unless you allow it. You can allow the read-only tools
  (`get_state`, `get_scene`, `snapshot`, `list_missions`, `check_mission`).
- The Claude consumer apps are for adults (18+). In schools, a teacher runs Claude and pupils
  watch or steer through the simulation.

## Limits

| What | Limit |
|---|---|
| Paired sessions on the server | 30 (then `CAPACITY`) |
| Open simulation tabs | 300 in total, 30 per IP address |
| `connect` attempts | 20 per minute per IP. After 10 failures in 10 min the IP waits 15 min |
| Tool calls per session | 5/s (burst 10), at most 4 in flight. `stop` is never limited |
| `snapshot` | 1 per second, up to 768 px wide |
| Motion length | `duration_s` from 0.2 to 20 s. A call fails after 30 s |
| Waiting for Allow | 60 s |
| Message size | 1 MiB per tab frame, 16 KB of tool arguments |

## For developers

- Server code is in `backend/bridge` (Node 24 + TypeScript, official MCP SDK v2,
  `@modelcontextprotocol/server` 2.4.0). It serves `/mcp`, `/tab` and `/healthz` on one port. The
  browser module is in `backend/bridge-client`. Its `README.md` describes the handler interface
  the simulation implements.
- Run it locally:

  ```sh
  cd backend/bridge
  npm ci
  npm run dev
  ```

  This starts `BRIDGE_DEV=1` on port 8080 and also allows `http://localhost` origins.
  Point the page at `ws://localhost:8080/tab`, then run
  `claude mcp add --transport http so101-dev http://localhost:8080/mcp`.
- Tests: `npm test` runs the unit tests and the end-to-end tests. The end-to-end tests drive a
  headless Chromium with the mock simulation and with the real MuJoCo page over the MCP client SDK.
  They need Playwright and are skipped without it.
- Configuration (env): `PORT` (8080), `APP_VERSION`, `TRUST_PROXY=1` behind Caddy,
  `ALLOWED_ORIGINS` (exact tab origins), `BRIDGE_MAX_SESSIONS`, `BRIDGE_HB_S`, `BRIDGE_CODE_TTL_S`,
  `BRIDGE_SNAPSHOT_DEADLINE_S`.
- Both protocol eras work: the stateless 2025-11-25 fallback and 2026-07-28. State lives only in
  the explicit `session` argument.

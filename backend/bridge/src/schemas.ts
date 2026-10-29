// Tool input schemas (zod), fixed descriptions and the static data the server owns.
// Units are always in the field name (_deg, _pct, _mm, _s). This file is the single source of truth:
// scripts/export-schemas.ts turns it into backend/bridge-client/schemas.json, which the tab uses to
// re-validate every call it receives (the tab never trusts the relay).

import { z } from 'zod';

export const ROBOT = 'so101';

/** Soft limits in API degrees (MJCF ctrlrange of Menagerie robotstudio_so101, rounded inwards). */
export const JOINT_LIMITS_DEG = {
  shoulder_pan: [-110, 110],
  shoulder_lift: [-100, 100],
  elbow_flex: [-96.8, 96.8],
  wrist_flex: [-95, 95],
  wrist_roll: [-157.2, 162.8]
} as const;
export type JointName = keyof typeof JOINT_LIMITS_DEG;
export const JOINT_NAMES = Object.keys(JOINT_LIMITS_DEG) as JointName[];
export const GRIPPER_LIMITS_PCT = [0, 100] as const;

export const UNITS = { angle: 'deg', gripper: 'pct_open', length: 'mm', time: 's', frame: 'base: x forward, y left, z up, origin at robot base on table top' };

/**
 * Missions the server knows. Titles/goals live here (server code), never in tab output, so
 * a tab cannot put free text in front of the model. The tab only reports which ids it supports.
 */
export const MISSIONS: Record<string, { title_cs: string; title_en: string; goal_en: string }> = {
  bowl: { title_cs: 'Přeneste kostku do misky', title_en: 'Put the cube in the bowl', goal_en: 'Pick up the orange cube and release it inside the blue bowl; it must rest there for 0.5 s.' },
  stack: { title_cs: 'Postavte věž', title_en: 'Build a tower', goal_en: 'Place the orange cube precisely on top of the blue cube.' },
  sort: { title_cs: 'Roztřiďte barvy', title_en: 'Sort the colours', goal_en: 'Put the orange cube into the orange bowl and the blue cube into the blue bowl.' },
  ball: { title_cs: 'Dostrkejte míček do branky', title_en: 'Push the ball into the goal', goal_en: 'The ball cannot be grasped. Close the gripper and push the ball into the goal.' },
  trace: { title_cs: 'Obkreslete hvězdu', title_en: 'Trace the star', goal_en: 'The gripper holds a pen. Lower the tip to the paper and trace the star outline.' },
  // object missions 06-10 (sim/so101/src/missions.js `objects: true`): the tab reloads into the object scene first
  line: { title_cs: 'Třídicí linka', title_en: 'Sorting line', goal_en: 'Sort the M8 nuts into the orange bin and the M8 bolts into the blue bin.' },
  breakfast: { title_cs: 'Snídaně', title_en: 'Breakfast', goal_en: 'Put the apple, the banana and the cupcake on the plate.' },
  tidy: { title_cs: 'Uklizený stůl', title_en: 'Tidy table', goal_en: 'Put the mug, the spoon, the fork and the sponge on the tray.' },
  workshop: { title_cs: 'Dílna', title_en: 'Workshop', goal_en: 'Put the screwdriver back into the printed holder, lying flat in its groove.' },
  lab: { title_cs: 'Laboratoř', title_en: 'Lab', goal_en: 'Slide the glass vial into the rack without knocking it over; it must stand upright.' }
};

export const VIEWS = ['overview', 'top', 'side', 'wrist'] as const;
export const SNAPSHOT_WIDTHS = [320, 512, 768] as const;

/** Error codes a tab may return. Anything else is mapped to TAB_ERROR. */
export const ERROR_CODES = [
  'INVALID_ARGUMENT', 'NOT_CONNECTED', 'TAB_GONE', 'SIM_ONLY', 'ESTOP_ACTIVE', 'BUSY', 'OUT_OF_LIMITS',
  'WORKSPACE_VIOLATION', 'UNREACHABLE', 'IK_NO_SOLUTION', 'COLLISION_PREDICTED', 'COLLISION_DETECTED',
  'TIMEOUT', 'UNKNOWN_MISSION', 'RENDER_UNAVAILABLE', 'TAB_HIDDEN', 'NOT_SUPPORTED', 'CANCELLED',
  'RATE_LIMITED', 'PAIRING_FAILED', 'PAIRING_DENIED', 'CAPACITY', 'TAB_ERROR', 'INTERNAL'
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_TEXT: Record<ErrorCode, { message: string; retryable: boolean; hint?: string }> = {
  INVALID_ARGUMENT: { message: 'Invalid argument.', retryable: false },
  NOT_CONNECTED: { message: 'Unknown or expired session.', retryable: false, hint: 'Ask the user for the 8-character code shown in the simulation panel and call connect again.' },
  TAB_GONE: { message: 'The simulation tab is closed or disconnected.', retryable: false, hint: 'Ask the user to reopen the SO-101 simulation, click "Connect AI", and give you the new code.' },
  SIM_ONLY: { message: 'This tool or option is only available in the simulation.', retryable: false },
  ESTOP_ACTIVE: { message: 'STOP is latched in the page. Only the user can release it.', retryable: false, hint: 'Ask the user to release STOP in the page.' },
  BUSY: { message: 'Another motion is running.', retryable: true, hint: 'Wait for it, call stop, or pass preempt: true.' },
  OUT_OF_LIMITS: { message: 'Target is outside the joint limits; nothing moved.', retryable: false, hint: 'See details for the allowed range in degrees.' },
  WORKSPACE_VIOLATION: { message: 'Motion would leave the allowed workspace; nothing moved.', retryable: false },
  UNREACHABLE: { message: 'Target is out of reach; nothing moved.', retryable: false },
  IK_NO_SOLUTION: { message: 'No inverse-kinematics solution found; nothing moved.', retryable: false, hint: 'Try another pitch_deg (or "auto") or a closer point.' },
  COLLISION_PREDICTED: { message: 'Motion would collide; nothing moved.', retryable: false },
  COLLISION_DETECTED: { message: 'Collision detected during motion; arm is holding.', retryable: false },
  TIMEOUT: { message: 'The call took too long; motion was stopped.', retryable: true },
  UNKNOWN_MISSION: { message: 'Unknown mission id.', retryable: false, hint: 'Call list_missions.' },
  RENDER_UNAVAILABLE: { message: 'Rendering is unavailable in the tab right now.', retryable: true },
  TAB_HIDDEN: { message: 'The simulation tab is in the background, so the simulation is paused.', retryable: true, hint: 'Ask the user to bring the simulation tab to the front.' },
  NOT_SUPPORTED: { message: 'This version of the simulation does not support that yet.', retryable: false },
  CANCELLED: { message: 'The call was cancelled.', retryable: true },
  RATE_LIMITED: { message: 'Too many requests.', retryable: true, hint: 'Slow down; see details.retry_after_ms.' },
  PAIRING_FAILED: { message: 'Pairing failed: the code is unknown, expired or already used.', retryable: false, hint: 'Ask the user for the current code shown in the simulation panel.' },
  PAIRING_DENIED: { message: 'The user did not allow the connection in the simulation tab (denied or no answer).', retryable: false },
  CAPACITY: { message: 'The server is at capacity.', retryable: true, hint: 'Try again in a few minutes.' },
  TAB_ERROR: { message: 'The simulation reported an error.', retryable: false },
  INTERNAL: { message: 'Internal error.', retryable: true }
};

// ---------- zod pieces ----------

const deg = (j: JointName): z.ZodNumber => {
  const [lo, hi] = JOINT_LIMITS_DEG[j];
  return z.number().describe(`degrees; absolute range ${lo}..${hi}`);
};
export const Session = z.string().max(64).describe('session handle returned by connect');
const RequestId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional()
  .describe('optional idempotency key: a repeat with the same id within 120 s returns the first result without moving again');
const Duration = z.number().min(0.2).max(20).optional().describe('seconds; omit for an automatic duration');
const Preempt = z.boolean().optional().describe('true = interrupt a running motion instead of failing with BUSY');

export const ArmJointsDeg = z.object({
  shoulder_pan: deg('shoulder_pan').optional(),
  shoulder_lift: deg('shoulder_lift').optional(),
  elbow_flex: deg('elbow_flex').optional(),
  wrist_flex: deg('wrist_flex').optional(),
  wrist_roll: deg('wrist_roll').optional()
}).strict();

const GripperPct = z.number().describe('percent open, 0 = closed, 100 = fully open');

const ToolPose = z.object({
  x_mm: z.number().min(-600).max(600),
  y_mm: z.number().min(-600).max(600),
  z_mm: z.number().min(-300).max(600),
  pitch_deg: z.union([z.number().min(-90).max(90), z.literal('auto')]).optional()
    .describe('approach angle of the jaw vs horizontal, -90 = straight down (about -80 is the steepest reachable); "auto" (default) = steepest feasible'),
  roll_deg: z.number().optional().describe('wrist_roll in degrees; omit to keep the current roll')
}).strict();

/** run_trajectory limits (the tab enforces them again, together with the speed cap and the workspace box). */
export const TRAJECTORY_MAX_WAYPOINTS = 50;
export const TRAJECTORY_MAX_S = 60;

const Waypoint = z.object({
  joints_deg: ArmJointsDeg.optional().describe('partial joint target; omitted joints keep the previous waypoint\'s value'),
  pose: ToolPose.optional().describe('jaw-tip target in mm (in-page IK); use either joints_deg or pose'),
  gripper_pct: GripperPct.optional(),
  duration_s: z.number().min(0.1).max(20).optional().describe('seconds for the segment that ends at this waypoint; omit or too short = stretched to the speed cap')
}).strict();

export const Inputs = {
  connect: z.object({
    code: z.string().min(1).max(32).describe('the 8-character pairing code shown in the simulation panel, e.g. "BCDF-GHJK"')
  }).strict(),
  get_state: z.object({ session: Session }).strict(),
  get_scene: z.object({
    session: Session,
    include: z.array(z.enum(['robot', 'objects', 'mission', 'safety', 'limits'])).max(5).optional()
  }).strict(),
  move_joints: z.object({
    session: Session,
    joints_deg: ArmJointsDeg.optional().describe('partial map of arm joints; omitted joints keep their current goal'),
    gripper_pct: GripperPct.optional(),
    relative: z.boolean().optional().describe('true = values are offsets from the current goal (not idempotent without request_id)'),
    duration_s: Duration,
    preempt: Preempt,
    request_id: RequestId
  }).strict(),
  move_to: z.object({
    session: Session,
    pose: ToolPose.describe('target for the jaw tip (site gripperframe) in the base frame, millimetres'),
    gripper_pct: GripperPct.optional(),
    duration_s: Duration,
    preempt: Preempt,
    request_id: RequestId
  }).strict(),
  run_trajectory: z.object({
    session: Session,
    waypoints: z.array(Waypoint).min(1).max(TRAJECTORY_MAX_WAYPOINTS)
      .describe(`1-${TRAJECTORY_MAX_WAYPOINTS} waypoints run as one smooth motion (at most ${TRAJECTORY_MAX_S} s in total)`),
    preempt: Preempt,
    request_id: RequestId
  }).strict(),
  set_gripper: z.object({
    session: Session,
    gripper_pct: z.union([GripperPct, z.enum(['open', 'close'])]).describe('percent open, or "open" (70 %) / "close" (0 %, force-limited)'),
    effort_pct: z.number().min(1).max(50).optional().describe('closing force cap, % of max torque (≤ 50)'),
    duration_s: Duration,
    preempt: Preempt,
    request_id: RequestId
  }).strict(),
  home: z.object({
    session: Session,
    pose: z.enum(['home', 'zero']).optional().describe('home = rest keyframe (default); zero = all joints 0°'),
    duration_s: Duration,
    preempt: Preempt,
    request_id: RequestId
  }).strict(),
  stop: z.object({ session: Session }).strict(),
  snapshot: z.object({
    session: Session,
    view: z.enum(VIEWS).optional().describe('camera: overview (default), top, side, wrist'),
    width: z.union([z.literal(320), z.literal(512), z.literal(768)]).optional().describe('image width in px (default 512)')
  }).strict(),
  list_missions: z.object({ session: Session }).strict(),
  start_mission: z.object({
    session: Session,
    mission_id: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/),
    request_id: RequestId
  }).strict(),
  check_mission: z.object({ session: Session }).strict(),
  reset_scene: z.object({ session: Session, request_id: RequestId }).strict()
} as const;

export type ToolName = keyof typeof Inputs;
export const TOOL_NAMES = Object.keys(Inputs) as ToolName[];
/** Tools forwarded to the tab (everything except connect). */
export const TAB_TOOLS = TOOL_NAMES.filter((t) => t !== 'connect') as Exclude<ToolName, 'connect'>[];
export const MOTION_TOOLS: ReadonlySet<string> = new Set(['move_joints', 'move_to', 'run_trajectory', 'set_gripper', 'home', 'start_mission', 'reset_scene']);

/** Fixed tool descriptions (never built from tab input). Order is stable for prompt caching. */
export const DESCRIPTIONS: Record<ToolName, string> = {
  connect: 'Pair with an SO-101 simulation open in the user\'s browser. The user clicks "Connect AI" in the simulation and reads you an 8-character code; the user must then click Allow in the tab. Returns a session handle that every other tool needs. The session ends when the tab closes.',
  get_state: 'Current arm state: joint angles (deg), gripper (% open), jaw-tip position (mm, base frame), whether it is moving, safety and mission state. Cheap; prefer this over snapshot.',
  get_scene: 'World as structured data: robot state, objects with poses in mm, mission state, safety and limits.',
  move_joints: 'Move arm joints to absolute angles in degrees (or offsets with relative: true) with a smooth profile and wait until done. Out-of-range targets are rejected with OUT_OF_LIMITS, never clamped.',
  move_to: 'Move the jaw tip to a point in millimetres (base frame: x forward, y left, z up) using in-page inverse kinematics, and wait until done.',
  run_trajectory: 'Run a list of waypoints (joint angles in degrees or jaw-tip points in mm, each with an optional gripper % and segment duration) as ONE smooth motion and wait until done: dances, waves, drawing a shape. The whole path is checked first (joint limits, speed cap, workspace); if any waypoint fails, nothing moves and the error says which (details.waypoint). Up to 50 waypoints and 60 s. stop / STOP in the page end it like any motion.',
  set_gripper: 'Open or close the gripper (percent open, or "open"/"close").',
  home: 'Move the arm to the home pose (or all-zero) and wait until done.',
  stop: 'Stop any motion now and hold the current pose. Always allowed. This is a software stop, not an emergency stop.',
  snapshot: 'Render a camera image of the simulation (JPEG): your only view of the scene (you never see the user). Costs tokens: use get_state/get_scene for numbers and snapshot only to verify visually.',
  list_missions: 'List the missions this simulation offers.',
  start_mission: 'Reset the scene for a mission and start its timer and success check.',
  check_mission: 'Mission status: id, state (idle|running|success|failed), elapsed seconds, and score fields if finished.',
  reset_scene: 'Reset the simulation scene and the arm to the start layout.'
};

export const ANNOTATIONS: Record<ToolName, { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }> = {
  connect: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  get_state: { readOnlyHint: true, openWorldHint: false },
  get_scene: { readOnlyHint: true, openWorldHint: false },
  move_joints: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  move_to: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  run_trajectory: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  set_gripper: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  home: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  stop: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  snapshot: { readOnlyHint: true, openWorldHint: false },
  list_missions: { readOnlyHint: true, openWorldHint: false },
  start_mission: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  check_mission: { readOnlyHint: true, openWorldHint: false },
  reset_scene: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
};

/** Per-call deadline the server gives the tab (ms). */
export function deadlineFor(tool: string, args: Record<string, unknown>, snapshotMs = 8_000): number {
  if (tool === 'run_trajectory') {
    // the tab stretches segments to the speed cap and refuses more than TRAJECTORY_MAX_S in total
    return (TRAJECTORY_MAX_S + 10) * 1000;
  }
  if (MOTION_TOOLS.has(tool)) {
    const d = typeof args.duration_s === 'number' ? args.duration_s : 5;
    return Math.min(30_000, Math.round(d * 1000) + 8_000);
  }
  if (tool === 'snapshot') return snapshotMs;
  return 5_000;
}

export interface LimitViolation { joint: string; value_deg: number; min_deg: number; max_deg: number }

/** Early, server-side limit check for absolute joint targets. The tab checks again with its own limits. */
export function checkLimits(tool: string, args: Record<string, any>): LimitViolation | { joint: 'gripper'; value_pct: number; min_pct: number; max_pct: number } | null {
  if (tool === 'move_joints' && !args.relative && args.joints_deg) {
    for (const j of JOINT_NAMES) {
      const v = args.joints_deg[j];
      if (typeof v !== 'number') continue;
      const [lo, hi] = JOINT_LIMITS_DEG[j];
      if (v < lo || v > hi) return { joint: j, value_deg: v, min_deg: lo, max_deg: hi };
    }
  }
  if (tool === 'move_to' && typeof args.pose?.roll_deg === 'number') {
    const v = args.pose.roll_deg, [lo, hi] = JOINT_LIMITS_DEG.wrist_roll;
    if (v < lo || v > hi) return { joint: 'wrist_roll', value_deg: v, min_deg: lo, max_deg: hi };
  }
  if (tool === 'run_trajectory' && Array.isArray(args.waypoints)) {
    for (const [i, w] of args.waypoints.entries()) {
      const v = checkLimits('move_joints', { joints_deg: w.joints_deg, gripper_pct: w.gripper_pct })
        ?? checkLimits('move_to', { pose: w.pose });
      if (v) return { ...v, waypoint: i } as any;
    }
  }
  const g = args.gripper_pct;
  if (typeof g === 'number' && !(tool === 'move_joints' && args.relative) && (g < 0 || g > 100)) {
    return { joint: 'gripper', value_pct: g, min_pct: 0, max_pct: 100 };
  }
  return null;
}

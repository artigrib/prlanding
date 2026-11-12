// Keyboard map of the mobile scene by mode (design §3.1). Pure (node tests check it against src/ux.js keys()).
//
// - Jízda (drive): the LeRobot LeKiwi teleop keys (config_lekiwi.py teleop_keys @ e6ffde60: w/s forward/back, a/d
//   left/right, z/x rotate), plus the arrows, and Q/E as the common game keys for turning; 1/2/3 pick the speed level
//   (LeRobot's r/f clash with our R = reset); Space stops (brake).
// - Ruka (arm): none of the drive keys are taken, so the arm's own shortcuts (src/ux.js keys(): arrows, Q/E, A/D,
//   Space, digits …) keep their meaning when the arm control comes to this scene (campaign PR 4).
// - Both modes: J switches Jízda ⇄ Ruka (J is free in ux.js), C cycles the camera views (ux.js: C = camera too),
//   R starts again (ux.js: R = reset too).

export const MODES = ['drive', 'arm'];
export const MODE_LABEL = { drive: 'Jízda', arm: 'Ruka' };

/** Jízda: e.key (lower-cased) → drive action of src/mobile/base.js. */
export const DRIVE_KEYS = {
  w: 'forward', arrowup: 'forward',
  s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
  q: 'turnLeft', z: 'turnLeft',
  e: 'turnRight', x: 'turnRight'
};
/** Jízda: speed levels (e.code Digit1–3 too: Czech layouts type +ěš on that row). */
export const LEVEL_KEYS = { 1: 0, 2: 1, 3: 2 };
export const BRAKE_KEY = ' ';
/** Both modes; the meaning matches ux.js where ux.js uses the same key. */
export const GLOBAL_KEYS = { j: 'mode', c: 'view', r: 'reset' };

const norm = (k) => (k && k.length === 1 ? k.toLowerCase() : String(k || '').toLowerCase());
function digit(key, code) {
  const m = /^Digit([0-9])$/.exec(code || '');
  return m ? m[1] : (key >= '0' && key <= '9' ? key : '');
}

/**
 * What a keydown does in this mode: { type: 'mode' | 'view' | 'reset' | 'drive' | 'level' | 'brake', action?, level? }
 * or null (the key is not ours: in Ruka mode that leaves every arm shortcut to the arm).
 */
export function keyAction(key, code, mode) {
  const k = norm(key);
  if (GLOBAL_KEYS[k]) return { type: GLOBAL_KEYS[k] };
  if (mode !== 'drive') return null;
  if (DRIVE_KEYS[k]) return { type: 'drive', action: DRIVE_KEYS[k] };
  if (key === BRAKE_KEY) return { type: 'brake' };
  const dg = digit(key, code);
  if (dg in LEVEL_KEYS) return { type: 'level', level: LEVEL_KEYS[dg] };
  return null;
}
/** keyup: which held drive action ends (any mode: a key pressed in Jízda can be released after a switch). */
export function keyRelease(key) { return DRIVE_KEYS[norm(key)] || null; }

/** Every key this scene takes in Jízda, as ux.js names them (lower-case letters, ' ', 'arrowup', '1' …). */
export function driveKeySet() {
  return new Set([...Object.keys(DRIVE_KEYS), BRAKE_KEY, ...Object.keys(LEVEL_KEYS), ...Object.keys(GLOBAL_KEYS)]);
}

// Episode -> replay file the SO-101 sim can play back: the "Učení ukázkou" demo format
// (printedrobotics.cz/so101-sim-demo@1, sim/so101/src/ui/teach.js toJSON/importJSON): 30 fps frames of
// observation.state / action in degrees (+ gripper % open) and the scene snapshot at the start (qpos, qvel, ctrl,
// mocap), so the page re-runs the episode open loop. Bench extras ride in printedrobotics.bench (the page ignores
// them): task, seed, model, the reset_scene frames and the jaw-tip path for side-by-side videos.
import { FPS } from './sim.mjs';

const NAMES = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
export const MAX_FRAMES = 180 * FPS + 60;      // = teach.js MAX_FRAMES (longer episodes are cut, flagged truncated)

export function toReplay(ep, { taskId, seed, model, missionId, title }) {
  const [glo, ghi] = ep.gripRange;
  const deg = (v) => Math.round(v * 180 / Math.PI * 100) / 100;
  const grip = (v) => Math.round((v - glo) / (ghi - glo) * 1000) / 10;
  const conv = (v) => v.map((x, i) => (i === 5 ? grip(x) : deg(x)));
  const frames = ep.frames.slice(0, MAX_FRAMES);
  const names = NAMES.map((n) => n + '.pos');
  return {
    format: 'printedrobotics.cz/so101-sim-demo@1',
    note: 'PR-Bench episode replay (simulation). Import it in the SO-101 sim (Učení ukázkou → import) to watch it.',
    robot_type: 'so101_follower',
    source: 'simulation (MuJoCo, printedrobotics.cz/sim/so101/), PR-Bench headless harness',
    fps: FPS,
    features: {
      'observation.state': { dtype: 'float32', shape: [6], names, unit: 'degrees, gripper.pos = 0–100 % open' },
      action: { dtype: 'float32', shape: [6], names, unit: 'degrees, gripper.pos = 0–100 % open' },
      timestamp: { dtype: 'float32', shape: [1] }, frame_index: { dtype: 'int64', shape: [1] }, episode_index: { dtype: 'int64', shape: [1] }
    },
    printedrobotics: {
      mission: missionId || null,
      snapshot: ep.initial,
      bench: { task: taskId, seed, model, truncated: ep.frames.length > MAX_FRAMES, resets_at_frame: ep.resets.slice(),
        tip_mm: frames.map((f) => f.tip.map((v) => Math.round(v * 10000) / 10)) }
    },
    episodes: [{
      episode_index: 0, task: title || taskId, length: frames.length,
      frames: frames.map((f, i) => ({ frame_index: i, timestamp: f.t, 'observation.state': conv(f.q), action: conv(f.c) }))
    }]
  };
}

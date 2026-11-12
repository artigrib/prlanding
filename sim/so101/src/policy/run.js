// Executor of the M12 tier (a) policy: "Naučené pravidlo (kNN) + plánovač". The learned rule (src/policy/knn.js)
// decides per item which bin, where along the belt to commit and how high to grasp; the scripted tracking planner
// (src/objects/beltpick.js beltSolve) moves the arm. DOM/three-free: the page (src/ui/policy.js), node tests and
// tools/belt-measure.mjs use the same function.

import { beltSolve, beltV } from '../objects/beltpick.js';
import { CONVEYOR_ITEMS } from '../objects/scene.js';
import { decide, obsOf } from './knn.js';

const CLASS_OF = Object.fromEntries(CONVEYOR_ITEMS.map((it) => [it.name, it.fraction]));
/** The label every surface shows while this policy moves the arm (design §2 M12, §7). */
export const KNN_LABEL = 'Naučené pravidlo (kNN) + plánovač';

/**
 * Plan (ArmController dyn loop, kind 'knn') that sorts belt items with the learned rule until opts.stop().
 * opts: { stop, log } as beltSolve. Returns the plan; plan.decisions collects { name: decision } as items are seen
 * (each item is decided once, from its pose on the belt the first time the loop sees it).
 */
export function knnSolve(ctl, w, model, opts = {}) {
  const decisions = {};
  const plan = beltSolve(ctl, w, Object.assign({}, opts, {
    decide: (n) => {
      const p = w.com(n, [0, 0, 0]);
      const D = decide(model, obsOf({ class: CLASS_OF[n], pos: p, yaw: w.yaw(n) }, beltV(w)));
      decisions[n] = D;
      if (opts.log) opts.log({ ev: 'decide', name: n, t: w.d.time, bin: D.bin, by: D.by || null, nn: D.nn });
      return D;
    }
  }));
  plan.kind = 'knn';
  plan.decisions = decisions;
  return plan;
}

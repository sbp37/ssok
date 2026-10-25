import type { Bead } from "../beads/Bead";
import { FREE_PADS } from "../ads/AdPolicy";

/**
 * "자석 싹쓸이": with only a few beads left, a rewarded ad takes the rest of the pad – every bead
 * lets go by itself and flies to the jar (Game.magnetSweep). Never on the ad-free opening pads,
 * never in a bonus dig (a handful of beads already).
 */
export const MAGNET_LEFT = 6;
/** the sweep's beat (s): the charge before the first bead lets go, then one bead per gap */
export const MAGNET_CHARGE = 0.5;
export const MAGNET_GAP = 0.1;
/** a deeper bead starts rising this long after its top bead left (Game.doPop) */
export const MAGNET_RISE = 0.42;

/** the pad on the table may offer the magnet (its ad, and once a pad, are the screen's to check) */
export function magnetAllowed(o: { left: number; completed: number; bonus: boolean }) {
  return !o.bonus && o.completed >= FREE_PADS && o.left > 0 && o.left <= MAGNET_LEFT;
}

/**
 * The order the magnet takes the beads in: the ones on top first, nearest the jar first; a bead
 * under another waits until its top bead has gone and it has begun to rise. `at`: seconds from
 * the start of the sweep.
 */
export function magnetOrder<B extends Pick<Bead, "layer" | "slot">>(left: B[], distance: (b: B) => number) {
  const covered = (b: B) => b.layer === 1 && left.some((o) => o.slot === b.slot && o.layer === 0);
  const nearest = (p: B, q: B) => distance(p) - distance(q);
  const top = left.filter((b) => !covered(b)).sort(nearest);
  const under = left.filter(covered).sort(nearest);
  const second = MAGNET_CHARGE + top.length * MAGNET_GAP + MAGNET_RISE;
  return [
    ...top.map((bead, i) => ({ bead, at: MAGNET_CHARGE + i * MAGNET_GAP })),
    ...under.map((bead, j) => ({ bead, at: second + j * MAGNET_GAP })),
  ];
}

import type { Bead } from "../beads/Bead";
import type { Fiber, FiberPoint } from "./Fiber";

/**
 * 뽁뽁이: one clear shipping-cushion dome over an ordinary bead.
 * Press → the dome squashes for a beat → 뽁 → pull the revealed bead normally.
 *
 * All positions are in the bead's reference frame (reference-pad units).
 * Nothing depends on elapsed time except the short squeeze of the dome that is
 * actually under the finger: holding still pops at most that one dome.
 */
export interface Dome {
  x: number;
  y: number;
  r: number;
  popped: boolean;
  /** 0..1 how far the finger has pressed it in */
  squash: number;
  /** game time it popped (for the little burst ring) */
  at: number;
}

/** One readable shipping-air-cushion dome, not five tiny game buttons. */
export const BUBBLE_DOMES = 1;
/** how long a held press squeezes before it pops (s) – short enough to feel instant */
export const BUBBLE_SQUEEZE = 0.09;
export function bubbleDomes(radius: number, angle: number): Dome[] {
  // Keep the argument for deterministic layout compatibility. A tiny offset
  // makes the dome feel physically seated rather than perfectly stamped on.
  return [{ x: Math.cos(angle) * radius * 0.025, y: Math.sin(angle) * radius * 0.025,
    r: radius * 0.9, popped: false, squash: 0, at: -1 }];
}

export function isBubble(f?: Fiber): f is Fiber & { domes: Dome[] } {
  return f?.kind === "bubble" && !!f.domes;
}

function nearest(domes: Dome[], p: FiberPoint) {
  let best = -1, bestD = Infinity;
  domes.forEach((d, i) => {
    if (d.popped) return;
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < bestD) { bestD = dist; best = i; }
  });
  return best;
}

/** One finger on one air cell. Every method returns the dome index it popped, or -1. */
export class BubblePress {
  private pressing = -1;
  private held = 0;
  private at: FiberPoint;

  constructor(readonly bead: Bead, x: number, y: number) {
    this.at = { x, y };
    // The whole blister is a forgiving mobile target.
    this.pressing = nearest(this.domes, this.at);
  }

  private get domes() {
    return this.bead.fiber!.domes!;
  }

  get complete() {
    const f = this.bead.fiber!;
    return f.pulled >= f.length;
  }

  /** the finger moved (bead-local reference units) */
  move(x: number, y: number) {
    this.at = { x, y };
    if (this.pressing < 0) return -1;
    const d = this.domes[this.pressing];
    // A deliberate press or quick flick both feel responsive; moving far away
    // cancels instead of popping an off-screen bubble by accident.
    if (Math.hypot(d.x - x, d.y - y) > d.r * 1.55) this.cancel();
    return -1;
  }

  /** time passes while the finger is down */
  tick(dt: number) {
    if (this.pressing < 0) return -1;
    this.held += dt;
    this.domes[this.pressing].squash = Math.min(1, this.held / BUBBLE_SQUEEZE);
    return this.held >= BUBBLE_SQUEEZE ? this.pop() : -1;
  }

  /** the finger lifted normally: a quick tap still pops what it was pressing */
  lift() {
    return this.pressing >= 0 ? this.pop() : -1;
  }

  /** gesture cancelled: nothing pops, the squeezed dome springs back */
  cancel() {
    if (this.pressing >= 0) this.domes[this.pressing].squash = 0;
    this.pressing = -1;
  }

  private pop() {
    const i = this.pressing;
    const d = this.domes[i];
    d.popped = true;
    d.squash = 1;
    this.bead.fiber!.pulled = this.domes.filter((x) => x.popped).length;
    this.pressing = -1;
    this.held = 0;
    return i;
  }
}

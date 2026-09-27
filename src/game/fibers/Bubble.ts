import type { Bead } from "../beads/Bead";
import type { Fiber, FiberPoint } from "./Fiber";

/**
 * 뽁뽁이 막: a clear film with a few air domes over an ordinary bead.
 * Press → the dome squashes for a beat → 뽁. Every dome popped frees the bead.
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

export const BUBBLE_DOMES = 5;
/** how long a held press squeezes before it pops (s) – short enough to feel instant */
export const BUBBLE_SQUEEZE = 0.09;
/** finger travel (reference units) between two domes popped by rubbing across */
const RUB_STEP = 7;

export function bubbleDomes(radius: number, angle: number): Dome[] {
  return Array.from({ length: BUBBLE_DOMES }, (_, i) => {
    const a = angle + (i / BUBBLE_DOMES) * Math.PI * 2;
    return { x: Math.cos(a) * radius * 0.58, y: Math.sin(a) * radius * 0.58, r: radius * 0.34, popped: false, squash: 0, at: -1 };
  });
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

/** One finger on one film. Every method returns the index of a dome it popped, or -1. */
export class BubblePress {
  private pressing = -1;
  private held = 0;
  private from: FiberPoint;
  private at: FiberPoint;

  constructor(readonly bead: Bead, x: number, y: number) {
    this.from = { x, y };
    this.at = { x, y };
    // a tap anywhere on the film presses the closest dome: no pixel hunting on a phone
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
    if (this.pressing >= 0) {
      const d = this.domes[this.pressing];
      // rolled off the dome it was squeezing: that one goes
      if (Math.hypot(d.x - x, d.y - y) > d.r * 1.6) return this.pop();
      return -1;
    }
    // rubbing across the film presses the next dome, holding still does not
    if (Math.hypot(x - this.from.x, y - this.from.y) >= RUB_STEP) {
      this.pressing = nearest(this.domes, this.at);
      this.held = 0;
    }
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
    this.from = { ...this.at };
    return i;
  }
}

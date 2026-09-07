import type { Bead } from "../beads/Bead";
import { REF_PAD_R } from "../beads/Bead";
import { clamp } from "../util/math";

/**
 * The resistance → release state machine for one held bead.
 *
 *  grip   finger moves, bead barely does; the gel around it stretches
 *  slip   past the grip distance the bead creeps out in small stick-slip
 *         steps; gel neck thins; "it's about to go"
 *  pop    past the pull distance *and* moving fast enough → resistance
 *         vanishes at once. (Pulling too violently can instead slip out
 *         of your fingers ~6% of the time.)
 */
export type PullPhase = "grip" | "slip";
export type PullEvent =
  | { kind: "tick"; step: number }
  | { kind: "slipStart" }
  | { kind: "pop"; dirX: number; dirY: number; speed: number }
  | { kind: "slipped" };

export class Pull {
  phase: PullPhase = "grip";
  /** 0..1 progress through the slip stage (drives neck thinning & lift) */
  progress = 0;
  /** where the finger was when it grabbed (pad-local) */
  readonly sx: number;
  readonly sy: number;
  private lastStep = 0;
  private wiggle = 0;
  private lastAng: number | null = null;
  private holdT = 0;
  readonly t1: number;
  readonly t2Base: number;
  private catchHold = 0;

  constructor(
    public bead: Bead,
    fx: number,
    fy: number,
    padR: number,
    private rand: () => number,
  ) {
    this.sx = fx;
    this.sy = fy;
    const s = padR / REF_PAD_R;
    const deep = bead.layer === 1 ? 1.25 : 1;
    this.t1 = bead.type.grip * s * deep;
    this.t2Base = bead.type.pull * s * (bead.layer === 1 ? 1.35 : 1);
  }

  /** current bead displacement target from the finger vector */
  update(fx: number, fy: number, speed: number, dt: number): PullEvent[] {
    const events: PullEvent[] = [];
    const b = this.bead;
    const dx = fx - this.sx;
    const dy = fy - this.sy;
    const dist = Math.hypot(dx, dy);
    const ux = dist > 1e-3 ? dx / dist : 0;
    const uy = dist > 1e-3 ? dy / dist : 0;

    // wiggle bookkeeping for long beads: changing pull direction frees them
    let t2 = this.t1 + this.t2Base;
    if (b.type.needsWiggle) {
      const ang = Math.atan2(dy, dx);
      if (this.lastAng !== null && dist > 4) {
        let d = ang - this.lastAng;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.wiggle = Math.min(1, this.wiggle + Math.abs(d) * 0.35);
      }
      this.lastAng = ang;
      // pulling across the long axis is hardest
      const axis = b.rot;
      const along = Math.abs(Math.cos(ang - axis));
      const axisFactor = 1.55 - 0.55 * along;
      t2 = this.t1 + this.t2Base * (axisFactor - 0.45 * this.wiggle);
    }

    let offMag: number;
    if (dist < this.t1) {
      this.phase = "grip";
      this.progress = 0;
      offMag = dist * 0.07;
    } else {
      if (this.phase === "grip") {
        this.phase = "slip";
        events.push({ kind: "slipStart" });
      }
      let p = clamp((dist - this.t1) / (t2 - this.t1), 0, 1);
      // edge catch: hold progress flat for a beat around type.catch
      if (b.type.catch !== undefined) {
        const c = b.type.catch;
        if (p > c && p < c + 0.18) {
          this.catchHold += dt;
          p = this.catchHold < 0.09 ? c : p;
        }
      }
      this.progress = p;
      // creeps out to ~2 radii by the threshold so the neck is visible, curve set by friction
      const creep = Math.pow(p, 1 + b.type.friction * 1.4) * b.radius * 2.6;
      offMag = this.t1 * 0.07 + creep;
      // stick-slip ticks
      const step = Math.floor(p * 6);
      if (step > this.lastStep && p < 1) {
        this.lastStep = step;
        events.push({ kind: "tick", step });
      }
      if (dist >= t2) {
        // beyond the threshold: pops if there's enough force, else stretches a bit more
        const extra = dist - t2;
        this.holdT += dt;
        const forced = extra > 26 * (this.t2Base / 30) || this.holdT > 0.45;
        if (speed >= b.type.minSpeed || forced) {
          const tooHard = speed > 1500 && this.rand() < 0.065;
          if (tooHard) events.push({ kind: "slipped" });
          else events.push({ kind: "pop", dirX: ux, dirY: uy, speed });
          return events;
        }
        offMag += extra * 0.18;
      }
    }
    b.off.setTarget(ux * offMag, uy * offMag);
    b.lift = this.phase === "grip" ? clamp(dist / this.t1, 0, 1) * 0.15 : 0.15 + this.progress * 0.85;
    return events;
  }
}

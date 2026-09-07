import type { Bead } from "../beads/Bead";
import { REF_PAD_R } from "../beads/Bead";
import { Spring2, springParams } from "./spring";
import { clamp } from "../util/math";

/**
 * The resistance → release state machine for one held bead.
 *
 *  grip   the finger moves, the bead does not. What moves is the *gel*: it
 *         stretches toward the finger (tension 0→1) while holding the bead.
 *  slip   past the grip distance the bead creeps out in stick-slip steps and
 *         the neck between socket and bead thins.
 *  pop    past the pull distance *and* moving fast enough → resistance
 *         vanishes at once. (Pulling too violently can instead slip out
 *         of your fingers ~6% of the time.)
 *
 * Order of motion, always: finger → gel (stretch spring, ~30ms behind) →
 * bead (off spring, slower) → ticks → neck → POP. Nothing moves in unison.
 */
export type PullPhase = "grip" | "slip";
export type PullEvent =
  | { kind: "tick"; step: number }
  | { kind: "slipStart" }
  | { kind: "pop"; dirX: number; dirY: number; speed: number }
  | { kind: "slipped" };

const stretchP = springParams(0.13, 0.5);

export class Pull {
  phase: PullPhase = "grip";
  /** 0..1 how hard the gel is holding on (grip build-up); stays 1 through slip */
  tension = 0;
  /** 0..1 progress through the slip stage (drives neck thinning & lift) */
  progress = 0;
  /** unit pull direction (finger away from grab point) */
  dirX = 0;
  dirY = 0;
  /** how far the gel around the socket is pulled toward the finger (pad-local px), lagging the finger */
  readonly stretch = new Spring2(stretchP.k, stretchP.damping);
  readonly sx: number;
  readonly sy: number;
  private lastStep = 0;
  private wiggle = 0;
  private lastAng: number | null = null;
  private holdT = 0;
  readonly t1: number;
  readonly t2Base: number;
  private catchHold = 0;
  private readonly s: number;

  constructor(
    public bead: Bead,
    fx: number,
    fy: number,
    padR: number,
    private rand: () => number,
  ) {
    this.sx = fx;
    this.sy = fy;
    const s = (this.s = padR / REF_PAD_R);
    const deep = bead.layer === 1 ? 1.25 : 1;
    this.t1 = bead.type.grip * s * deep;
    this.t2Base = bead.type.pull * s * (bead.layer === 1 ? 1.35 : 1);
  }

  update(fx: number, fy: number, speed: number, dt: number): PullEvent[] {
    const events: PullEvent[] = [];
    const b = this.bead;
    const s = this.s;
    const dx = fx - this.sx;
    const dy = fy - this.sy;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-3) {
      this.dirX = dx / dist;
      this.dirY = dy / dist;
    }
    const ux = this.dirX;
    const uy = this.dirY;

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
      const along = Math.abs(Math.cos(ang - b.rot));
      const axisFactor = 1.55 - 0.55 * along;
      t2 = this.t1 + this.t2Base * (axisFactor - 0.45 * this.wiggle);
    }

    let offMag: number;
    if (dist < this.t1) {
      this.phase = "grip";
      this.progress = 0;
      this.tension = clamp(dist / this.t1, 0, 1);
      // the bead itself only starts to give in the last 40% of the grip, and barely
      offMag = this.tension > 0.6 ? ((this.tension - 0.6) / 0.4) * 1.6 * s : 0;
    } else {
      if (this.phase === "grip") {
        this.phase = "slip";
        events.push({ kind: "slipStart" });
      }
      this.tension = 1;
      let p = clamp((dist - this.t1) / (t2 - this.t1), 0, 1);
      if (b.type.catch !== undefined) {
        const c = b.type.catch;
        if (p > c && p < c + 0.18) {
          this.catchHold += dt;
          p = this.catchHold < 0.09 ? c : p;
        }
      }
      this.progress = p;
      // creeps out to ~2.4 radii by the threshold so the neck is visible, curve set by friction
      const creep = Math.pow(p, 1 + b.type.friction * 1.4) * b.radius * 2.4;
      offMag = 1.6 * s + creep;
      const step = Math.floor(p * 6);
      if (step > this.lastStep && p < 1) {
        this.lastStep = step;
        events.push({ kind: "tick", step });
      }
      if (dist >= t2) {
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
    // gel around the socket is dragged toward the finger: 6~18px at full grip, a bit more while slipping
    const stretchLen = this.tension * 16 * s + this.progress * 5 * s;
    this.stretch.setTarget(ux * stretchLen, uy * stretchLen);
    this.stretch.step(dt);
    b.off.setTarget(ux * offMag, uy * offMag);
    b.lift = this.phase === "grip" ? this.tension * 0.12 : 0.12 + this.progress * 0.88;
    return events;
  }
}

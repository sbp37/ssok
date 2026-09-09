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
 *         the neck between socket and bead thins. Big beads *wedge* on the
 *         way out: once or twice the bead stops while the finger keeps going
 *         (the gel tents further, the bead quivers), then it gives with a lurch.
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
  | { kind: "slipped" }
  /** grip nearly maxed: the gel audibly strains (once per grab) */
  | { kind: "strain" }
  /** a big bead wedged in the socket – the finger travels, the bead does not */
  | { kind: "jamStart" }
  /** …and gave way */
  | { kind: "jamFree" };

/** a point in the slip stage where the bead wedges and holds for `w` px of extra finger travel */
interface Jam {
  p: number;
  w: number;
  hit: boolean;
  freed: boolean;
}

/** reference-pad radius above which a bead starts to wedge on the way out (tiny/marble never do) */
const JAM_R0 = 12;

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
  /** 0..1 how much this bead wedges on the way out – from its actual size, so two
   *  beads of one type never feel identical (tiny/marble: 0, big pearl ≈0.5, treasures 1) */
  readonly jam: number;
  private readonly jams: Jam[] = [];
  /** true while wedged */
  jammed = false;
  /** 0..1 how far the finger has strained through the current wedge */
  over = 0;
  private quiver = 0;
  private strained = false;
  private readonly neck: number;
  /** progress at which this bead may slip back in (rolled once per grab) */
  private readonly fakeAt: number | null;
  /** bookkeeping for the creak grains played while wedged (owned by the caller) */
  creakT = 0;

  constructor(
    public bead: Bead,
    fx: number,
    fy: number,
    padR: number,
    private rand: () => number,
    /** pad-level × local grip multiplier (thin petal tips <1, a knot >1) */
    resist = 1,
  ) {
    this.sx = fx;
    this.sy = fy;
    const s = (this.s = padR / REF_PAD_R);
    const deep = bead.layer === 1 ? 1.25 : 1;
    // no two beads sit equally tight: ±12% on both distances, per bead
    const seat = 1 + (rand() - 0.5) * 0.24;
    this.t1 = bead.type.grip * s * deep * resist * seat;
    this.t2Base = bead.type.pull * s * (bead.layer === 1 ? 1.35 : 1) * resist * seat;
    // big pearl ≈0.5 (≈13px of extra travel), a buried treasure 1 (two wedges, ≈44px)
    this.jam = bead.type.jam ?? clamp((bead.radius / s - JAM_R0) / 8, 0, 1);
    this.neck = bead.type.neck ?? 1;
    // "almost out… and it's back in": once per bead, only if the type does that at all
    this.fakeAt = !bead.fakedOut && bead.type.fakeout && rand() < bead.type.fakeout ? 0.68 + rand() * 0.2 : null;
    if (this.jam > 0) {
      this.jams.push({ p: 0.38 + (rand() - 0.5) * 0.16, w: this.jam * 30 * s, hit: false, freed: false });
      if (this.jam > 0.55) this.jams.push({ p: 0.72 + (rand() - 0.5) * 0.1, w: this.jam * 14 * s, hit: false, freed: false });
    }
  }

  /** extra finger travel the wedges add before the pop (px) */
  get extraTravel() {
    return this.jams.reduce((a, j) => a + j.w, 0);
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
      if (this.tension > 0.75 && !this.strained) {
        this.strained = true;
        events.push({ kind: "strain" });
      }
      // the bead itself only starts to give in the last 40% of the grip, and barely
      offMag = this.tension > 0.6 ? ((this.tension - 0.6) / 0.4) * 1.6 * s : 0;
      this.jammed = false;
      this.over = 0;
    } else {
      if (this.phase === "grip") {
        this.phase = "slip";
        events.push({ kind: "slipStart" });
      }
      this.tension = 1;
      // wedges eat finger travel: inside one the bead holds still and the strain builds
      const span = t2 - this.t1;
      let d = dist - this.t1;
      let jammed = false;
      let over = 0;
      for (const j of this.jams) {
        const dj = j.p * span;
        if (d <= dj) break;
        if (d < dj + j.w) {
          over = (d - dj) / j.w;
          d = dj;
          jammed = true;
          if (!j.hit) {
            j.hit = true;
            events.push({ kind: "jamStart" });
          }
          break;
        }
        if (j.hit && !j.freed) {
          j.freed = true;
          events.push({ kind: "jamFree" });
        }
        d -= j.w;
      }
      this.jammed = jammed;
      this.over = jammed ? over : 0;
      let p = clamp(d / span, 0, 1);
      if (b.type.catch !== undefined) {
        const c = b.type.catch;
        if (p > c && p < c + 0.18) {
          this.catchHold += dt;
          p = this.catchHold < 0.09 ? c : p;
        }
      }
      this.progress = p;
      if (this.fakeAt !== null && p >= this.fakeAt) {
        events.push({ kind: "slipped" });
        return events;
      }
      // creeps out to ~2.4 radii by the threshold (further for a long-necked charm), curve set by friction
      const creep = Math.pow(p, 1 + b.type.friction * 1.4) * b.radius * 2.4 * this.neck;
      offMag = 1.6 * s + creep;
      if (jammed) {
        // wedged: the bead quivers in place while the finger strains against it
        this.quiver += dt;
        offMag += Math.sin(this.quiver * Math.PI * 2 * 22) * 0.55 * s * over;
      }
      const step = Math.floor(p * 6);
      if (step > this.lastStep && p < 1) {
        this.lastStep = step;
        events.push({ kind: "tick", step });
      }
      if (d >= span) {
        const extra = d - span;
        this.holdT += dt;
        // a stalled pull still gives up eventually – quickly for a small bead, only after a
        // real struggle for a heavy or wedging one (that is where "too easy" came from)
        const holdLimit = 0.45 + 0.8 * clamp((b.type.mass - 0.5) / 1.5, 0, 1) + 0.6 * this.jam;
        const forced = extra > (34 + 40 * this.jam) * (this.t2Base / 30) || this.holdT > holdLimit;
        if (speed >= b.type.minSpeed || forced) {
          const tooHard = speed > 1500 && this.rand() < 0.065;
          if (tooHard) events.push({ kind: "slipped" });
          else events.push({ kind: "pop", dirX: ux, dirY: uy, speed });
          return events;
        }
        offMag += extra * 0.18;
      }
    }
    // gel around the socket is dragged toward the finger: 6~18px at full grip, a bit more while
    // slipping – and further still while straining against a wedge (that IS the visible effort)
    const stretchLen = this.tension * 16 * s + this.progress * 5 * s * this.neck + this.over * this.jam * 14 * s;
    this.stretch.setTarget(ux * stretchLen, uy * stretchLen);
    // Same spring / resistance at 60Hz. A 50ms frame exceeds this stiff
    // spring's stable Euler step and used to send the rendered tent offscreen.
    const stretchSteps = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < stretchSteps; i++) this.stretch.step(dt / stretchSteps);
    b.off.setTarget(ux * offMag, uy * offMag);
    b.lift = this.phase === "grip" ? this.tension * 0.12 : 0.12 + this.progress * 0.88;
    return events;
  }
}

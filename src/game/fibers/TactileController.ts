import type { Bead } from "../beads/Bead";
import type { Gel } from "../gel/Gel";
import type { PointerSample } from "../input/Pointer";
import { sfx } from "../audio/Sfx";
import { haptics } from "../haptics";
import type { Rng } from "../util/math";
import { chainCount, chainFraction, exposedFiber, fiberPoint, FiberPull, isChain, relaxFiber, revealsBead, type FiberPoint } from "./Fiber";
import { drawFiber } from "./FiberRenderer";
import { installOpeningTactiles, installRoundTactiles, installTactile, roundTactile, tactileHint, type TactileKind } from "./Tactile";
import { drawChain, drawPeel, drawSwirl } from "./TactileRenderer";

/** What the controller needs from the game. Kept narrow on purpose. */
export interface TactileHost {
  readonly gel: Gel;
  /** pad scale (gel.R / REF_PAD_R) */
  readonly s: number;
  readonly beads: Bead[];
  readonly time: number;
}

/** hand a finished tactile to the ordinary POP → flight → jar sequence */
export type TactilePop = (b: Bead, fingerId: number, dx: number, dy: number, speed: number) => void;

/** How a finished tactile differs from an ordinary bead at POP time. */
export interface TactilePopStyle {
  /** pad-local start of the flight */
  pos: FiberPoint;
  releaseScale: number;
  /** kick distance in reference units (the caller scales it) */
  kick: number;
  hang: number;
  /** multiplier for the recoil and ring-down shock */
  recoil: number;
  /** the bead leaves a normal socket behind (it came out of its own slot) */
  socket: boolean;
  /** play the tactile's own release cue instead of the bead's POP */
  releaseSound: boolean;
  /** the jar makes a landing sound for it */
  landSound: boolean;
}

/**
 * Every non-bead touch material (yarn, strands, swirl, film) in one place:
 * which ones a pad gets, hit-testing, the gesture, feedback, drawing and how
 * each hands over to the ordinary POP. Game only routes pointers and frames.
 */
export class TactileController {
  private pulls = new Map<number, FiberPull>();
  private tried = new Set<TactileKind>();
  private hintUntil = 0;
  /** the round's featured material (undefined in `?test=` pads) */
  kind?: TactileKind;

  constructor(private host: TactileHost, private pop: TactilePop) {}

  /** place this pad's materials into already generated safe slots */
  install(completed: number, rng: Rng, testPad: boolean) {
    this.pulls.clear();
    const { gel, beads, time } = this.host;
    // Dedicated static QA builds expose direct demos; normal Pages/AIT builds
    // cannot bypass the first-round progression with a URL parameter.
    const query = import.meta.env.DEV || import.meta.env.MODE === "tactile-preview" ? new URLSearchParams(location.search) : undefined;
    const preview = query?.get("tactile");
    const forced = query?.has("fibers") ? "fiber" : isTactileKind(preview) ? preview : undefined;
    this.kind = forced ?? roundTactile(completed);
    if (testPad || !this.kind) return;
    if (forced) installTactile(beads, gel.R, rng, this.kind);
    else if (completed === 0) installOpeningTactiles(beads, gel.R, rng);
    else installRoundTactiles(beads, gel.R, rng, this.kind);
    this.hintUntil = time + 10;
  }

  /** pad-local, warped position of a point given in the bead's reference frame */
  local(b: Bead, p: FiberPoint) {
    const s = this.host.s;
    const point = { x: b.rx + p.x * s, y: b.ry + p.y * s };
    this.host.gel.warp(point.x, point.y, point);
    return point;
  }

  /** touch distance to a grabbable tactile, or Infinity when out of reach */
  hitDistance(b: Bead, lx: number, ly: number) {
    const f = b.fiber!, tilt = this.host.gel.tilt;
    const end = this.local(b, f.tip);
    let d = Math.hypot(end.x - lx, (end.y - ly) * tilt);
    if (f.kind === "peel") {
      const centre = this.local(b, { x: 0, y: 0 });
      const dc = Math.hypot(centre.x - lx, (centre.y - ly) * tilt);
      if (dc < b.radius) d = Math.min(d, dc);
    }
    return d < 22 ? d : Infinity;
  }

  /** does pressing this material also dimple the gel under the finger? */
  dimples(_b: Bead) {
    return false;
  }

  holding(id: number) {
    return this.pulls.has(id);
  }

  dimplesFinger(_id: number) {
    return false;
  }

  /** the finger left the screen normally (not cancelled), after its last move */
  lift(_sample: PointerSample) {}

  grab(id: number, b: Bead, lx: number, ly: number) {
    const f = b.fiber!, s = this.host.s;
    b.state = "held";
    if (!revealsBead(f)) this.tried.add(f.kind ?? "fiber");
    else this.hintUntil = this.host.time + 6;
    this.pulls.set(id, new FiberPull(b, (lx - b.rx) / s, (ly - b.ry) / s));
  }

  move(sample: PointerSample, lx: number, ly: number) {
    const pull = this.pulls.get(sample.id);
    if (!pull) return;
    const { s, gel } = this.host;
    const b = pull.bead, f = b.fiber!;
    const complete = pull.move((lx - b.rx) / s, (ly - b.ry) / s);
    if (f.kind === "peel" && f.pulled > f.length * .14) this.tried.add("peel");
    if (f.kind === "peel" || !f.kind) {
      const stage = Math.min(2, Math.floor(f.pulled / f.length * 3));
      if (stage > (f.felt ?? 0)) {
        f.felt = stage;
        if (!complete) { sfx.tactileStep(f.kind ?? "fiber", stage); haptics.tactileStep(f.kind ?? "fiber"); }
      }
    }
    if (f.kind === "swirl") {
      if (f.pulled > f.length * .1) this.tried.add("swirl");
      const stage = Math.floor(f.pulled / f.length * 5);
      if (stage > (f.felt ?? 0)) { f.felt = stage; if (!complete) { sfx.tactileStep("swirl", stage); haptics.tactileStep("swirl"); } }
    }
    if (isChain(f)) {
      const step = Array.from({ length: chainCount(f) - 1 }, (_, i) => chainFraction(f, i + 1)).filter(v => f.pulled / f.length >= v).length;
      if (step > (f.felt ?? 0)) {
        f.felt = step;
        // One feedback event per input sample, even on a very fast swipe.
        // Nothing is queued after releasing or leaving the pad.
        if (!complete) { sfx.tactileStep(f.kind ?? "chain", step); haptics.tactileStep(f.kind ?? "chain"); }
        const root = fiberPoint(f);
        gel.shock(b.rx + root.x * s, b.ry + root.y * s, 6 * s, (f.kind === "charm" ? 2.7 : 2.1) * s);
      }
    }
    if (complete) {
      const tip = this.local(b, f.tip);
      f.released = exposedFiber(f).map(p => {
        const point = this.local(b, p);
        return { x: (point.x - tip.x) / s, y: (point.y - tip.y) * gel.tilt / s };
      });
      const root = fiberPoint(f), dx = f.tip.x - root.x, dy = f.tip.y - root.y, d = Math.hypot(dx, dy) || 1;
      this.pulls.delete(sample.id);
      this.pop(b, sample.id, dx / d, dy / d, sample.speed);
    }
  }

  /** Finger up / cancelled, after its last move. Partial extraction stays where it is. */
  release(id: number) {
    const pull = this.pulls.get(id);
    if (!pull) return false;
    this.pulls.delete(id);
    pull.bead.state = "embedded";
    return true;
  }

  /** A rotation cancels the gesture, not the already extracted length. Returns the fingers it dropped. */
  cancelAll() {
    const ids = [...this.pulls.keys()];
    for (const pull of this.pulls.values()) if (pull.bead.state === "held") pull.bead.state = "embedded";
    this.pulls.clear();
    return ids;
  }

  clear() {
    this.pulls.clear();
  }

  /** held materials tug the gel; loose ends relax */
  update(dt: number) {
    const { gel, s, beads } = this.host;
    for (const p of this.pulls.values()) {
      const b = p.bead, f = b.fiber!, root = fiberPoint(f);
      const dx = f.tip.x - root.x, dy = f.tip.y - root.y, d = Math.hypot(dx, dy) || 1;
      gel.pulls.push({ hx: b.rx + root.x * s, hy: b.ry + root.y * s,
        sx: dx / d * Math.min(d, 10) * s, sy: dy / d * Math.min(d, 10) * s, r: 5 * s });
    }
    for (const b of beads) if (b.fiber && b.state === "embedded") relaxFiber(b.fiber, dt);
  }

  popStyle(b: Bead): TactilePopStyle {
    const f = b.fiber!;
    const revealed = revealsBead(f);
    return {
      pos: revealed ? this.local(b, { x: 0, y: 0 }) : this.local(b, f.tip),
      releaseScale: revealed ? .76 : 1,
      kick: f.kind === "charm" ? 17 : 9,
      hang: 0.2,
      recoil: f.kind === "charm" ? .8 : .6,
      socket: revealed,
      releaseSound: !revealed,
      landSound: revealed || isChain(f),
    };
  }

  /** a POP happened on this pad (any bead) */
  onPop() {}

  /** the one-line how-to for the round's featured material, or null */
  hintText(): string | null {
    const { kind } = this;
    if (!kind || this.tried.has(kind) || this.host.time >= this.hintUntil) return null;
    return this.host.beads.some(b => b.fiber) ? tactileHint[kind] : null;
  }

  /** pad-space overlay, drawn right after the gel surface */
  draw(ctx: CanvasRenderingContext2D, dpr: number) {
    const { gel, s, beads } = this.host;
    ctx.save();
    ctx.globalAlpha = gel.fade;
    for (const b of beads) {
      if (!b.fiber) continue;
      const removed = b.state !== "embedded" && b.state !== "held";
      const map = (p: FiberPoint) => this.local(b, p);
      if (b.fiber.kind === "peel") {
        if (!removed) drawPeel(ctx, b, map, s, dpr);
      } else if (b.fiber.kind === "swirl") {
        if (!removed) drawSwirl(ctx, b, map, s, dpr);
      } else if (isChain(b.fiber)) {
        drawChain(ctx, b, map, s, dpr, removed);
      } else drawFiber(ctx, b.fiber, map, s, b.state === "held", removed, gel.col(.9, .12));
    }
    ctx.restore();
  }

  /** The actual touch targets, including a partially extracted yarn end (debug / e2e). */
  debug(toCanvas: (x: number, y: number) => FiberPoint) {
    const s = this.host.s;
    return this.host.beads.filter(b => b.fiber && (b.state === "embedded" || b.state === "held")).map(b => {
      const f = b.fiber!, p = this.local(b, f.tip), screen = toCanvas(p.x, p.y);
      return { id: b.id, kind: f.kind ?? "fiber", x: screen.x, y: screen.y, pulled: f.pulled, length: f.length, state: b.state, scale: s };
    });
  }
}

function isTactileKind(v: string | null | undefined): v is TactileKind {
  return v === "chain" || v === "rainbow" || v === "charm" || v === "peel" || v === "swirl" || v === "fiber";
}

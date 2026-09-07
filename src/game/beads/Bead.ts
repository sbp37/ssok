import { Spring, Spring2, springParams } from "../physics/spring";
import { Rng } from "../util/math";
import { BEAD_TYPES, RARITY_WEIGHT, type BeadType, type Rarity } from "./BeadTypes";

export type BeadState = "embedded" | "held" | "flying" | "collected" | "gone";

export interface FlyPath {
  /** pad-local start (after the pop kick) */
  x0: number;
  y0: number;
  /** control point + end, canvas coords */
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  /** pop kick vector (pad-local px) applied during the first ~90ms */
  kx: number;
  ky: number;
  /** pad-local position where it popped */
  px: number;
  py: number;
  spin: number;
}

export interface Bead {
  id: number;
  type: BeadType;
  color: string;
  /** live radius in px */
  radius: number;
  rot: number;
  layer: 0 | 1;
  slot: number;
  /** rest position, pad-local px */
  rx: number;
  ry: number;
  /** pull displacement (lags the finger a little – that lag *is* the mass feel) */
  off: Spring2;
  /** 1 = deep in the gel (dim, small), 0 = at the surface */
  depth: Spring;
  /** 0..1 – how far it has been dragged out of the socket (render lift/scale) */
  lift: number;
  state: BeadState;
  fly?: FlyPath;
  sparkle: number;
}

let nextId = 1;

// ζ≈0.3 → a released bead snaps back with ~2 small overshoots
const off = springParams(0.17, 0.3);
const depth = springParams(0.45, 0.7);

export function makeBead(type: BeadType, color: string, radius: number, rot: number, layer: 0 | 1, slot: number, rx: number, ry: number): Bead {
  return {
    id: nextId++,
    type,
    color,
    radius,
    rot,
    layer,
    slot,
    rx,
    ry,
    off: new Spring2(off.k, off.damping),
    depth: (() => {
      const s = new Spring(depth.k, depth.damping);
      s.set(layer === 1 ? 1 : 0);
      return s;
    })(),
    lift: 0,
    state: "embedded",
    sparkle: Math.random() * Math.PI * 2,
  };
}

/** current pad-local centre (rest + pull) */
export function beadPos(b: Bead) {
  return { x: b.rx + b.off.x, y: b.ry + b.off.y };
}

/** scale factor for a bead's live radius from the reference-pad radius */
export const REF_PAD_R = 170;

function pickType(rng: Rng, skew: Partial<Record<Rarity, number>> = {}): BeadType {
  const rarity = rng.weighted(Object.keys(RARITY_WEIGHT) as Rarity[], (r) => RARITY_WEIGHT[r] * (skew[r] ?? 1));
  const pool = BEAD_TYPES.filter((t) => t.rarity === rarity);
  return rng.pick(pool);
}

/**
 * Lay out a fresh pad. Two layers:
 *  - layer 0: the surface, skewed toward small easy beads (first ~10s feel great)
 *  - layer 1: beads embedded deeper under ~60% of the surface slots, skewed
 *    bigger / odder. They surface once the bead above is gone, which is how
 *    the second half of a 30s run gets naturally chewier without a difficulty
 *    switch.
 */
export interface PadOptions {
  surface?: number;
  /** rest outline radius multiplier at angle θ (lobed silhouette) */
  boundary?: (theta: number) => number;
  /** add the deeper layer (default true) */
  deeper?: boolean;
  /** spread beads out (test pads) */
  spacing?: number;
}

export function generatePad(padR: number, rng: Rng, opts: PadOptions = {}): Bead[] {
  const s = padR / REF_PAD_R;
  const surfaceCount = opts.surface ?? 52;
  const boundary = opts.boundary ?? (() => 1);
  const margin = padR * 0.16;
  const gap = (opts.spacing ?? 4.5) * s;

  // choose types first, biggest first for packing
  const picks: { type: BeadType; radius: number }[] = [];
  for (let i = 0; i < surfaceCount; i++) {
    const type = pickType(rng, { common: 1.25, big: 0.7, odd: 0.8 });
    const radius = rng.range(type.radius[0], type.radius[1]) * s;
    picks.push({ type, radius });
  }
  picks.sort((a, b) => b.radius - a.radius);

  const beads: Bead[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  let slot = 0;
  for (const p of picks) {
    const footprint = p.type.shape === "oval" ? p.radius * (p.type.aspect ?? 1.7) * 0.78 : p.radius;
    let ok = false;
    for (let tries = 0; tries < 260 && !ok; tries++) {
      const ang = rng.next() * Math.PI * 2;
      const edge = padR * boundary(ang) - margin - footprint;
      if (edge <= 0) continue;
      const rad = Math.sqrt(rng.next()) * edge;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      let clear = true;
      for (const q of placed) {
        if (Math.hypot(q.x - x, q.y - y) < q.r + footprint + gap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      placed.push({ x, y, r: footprint });
      const color = rng.pick(p.type.colors);
      const rot = p.type.shape === "circle" ? 0 : rng.range(-Math.PI, Math.PI);
      beads.push(makeBead(p.type, color, p.radius, rot, 0, slot, x, y));
      // deeper bead under this slot?
      if (opts.deeper !== false && rng.chance(0.62)) {
        const dt = pickType(rng, { common: 0.6, big: 1.6, odd: 1.5, special: 1.1 });
        const dr = Math.min(footprint * 1.02, rng.range(dt.radius[0], dt.radius[1]) * s);
        const dcolor = rng.pick(dt.colors);
        const drot = dt.shape === "circle" ? 0 : rng.range(-Math.PI, Math.PI);
        beads.push(makeBead(dt, dcolor, Math.max(dr, 7 * s), drot, 1, slot, x, y));
      }
      slot++;
      ok = true;
    }
  }
  return beads;
}

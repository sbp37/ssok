import { Spring, Spring2, springParams } from "../physics/spring";
import { Rng } from "../util/math";
import { BEAD_TYPES, HIDDEN_TYPES, RARITY_WEIGHT, ULTRA_TYPES, type BeadType, type Rarity } from "./BeadTypes";

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
  /** seconds the bead hangs near the socket after the kick before flying off */
  hang: number;
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
  /** the pad's hidden object – drawn dim & partial under its host until the pad empties out */
  hidden?: boolean;
  /** already did its "almost… no" slip back into the hole (each bead does it at most once) */
  fakedOut?: boolean;
  /** deep beads: radius of the hole above them – a bigger object shows small in it and grows as it's pulled out */
  slotR?: number;
}

let nextId = 1;

// ζ≈0.3 → a released bead snaps back with ~2 small overshoots
const off = springParams(0.17, 0.3);
const depth = springParams(0.8, 0.95);

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

function pickType(rng: Rng, skew: Partial<Record<Rarity, number>> = {}, typeSkew: Record<string, number> = {}): BeadType {
  const rarity = rng.weighted(Object.keys(RARITY_WEIGHT) as Rarity[], (r) => RARITY_WEIGHT[r] * (skew[r] ?? 1));
  const pool = BEAD_TYPES.filter((t) => t.rarity === rarity);
  return rng.weighted(pool, (t) => typeSkew[t.id] ?? 1);
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
  /** force these type ids, cycling (test pads) */
  forceTypes?: string[];
  /** inner hole radius multiplier at angle θ (ring pads) */
  hole?: (theta: number) => number;
  raritySkew?: Partial<Record<Rarity, number>>;
  typeSkew?: Record<string, number>;
  /** the bead nearest the centre becomes a rare with this chance */
  rareCenterChance?: number;
  /** hidden object type id: one big bead buried deep near the middle */
  hiddenObject?: string;
  /** chance that one ordinary deep bead is secretly an ultra-rare object */
  ultraChance?: number;
  /** average chance of a second bead under a surface bead (default 0.4); 1.5× at the centre, 0.5× at the rim */
  deeperChance?: number;
}

export function generatePad(padR: number, rng: Rng, opts: PadOptions = {}): Bead[] {
  const s = padR / REF_PAD_R;
  const surfaceCount = opts.surface ?? 52;
  const boundary = opts.boundary ?? (() => 1);
  const hole = opts.hole;
  const margin = padR * 0.16;
  const skew = { common: 1.25, big: 0.7, odd: 0.8, ...(opts.raritySkew ?? {}) } as Partial<Record<Rarity, number>>;
  const typeSkew = opts.typeSkew ?? {};
  const gap = (opts.spacing ?? 4.5) * s;

  // choose types first, biggest first for packing
  const picks: { type: BeadType; radius: number }[] = [];
  // no single type may crowd the surface (a pad of ten identical crystals looks like a pattern)
  const perType = new Map<string, number>();
  const cap = Math.max(3, Math.ceil(surfaceCount * 0.26));
  for (let i = 0; i < surfaceCount; i++) {
    const forced = opts.forceTypes?.length ? BEAD_TYPES.find((t) => t.id === opts.forceTypes![i % opts.forceTypes!.length]) : undefined;
    let type = forced ?? pickType(rng, skew, typeSkew);
    for (let k = 0; !forced && k < 6 && (perType.get(type.id) ?? 0) >= cap; k++) type = pickType(rng, skew, typeSkew);
    perType.set(type.id, (perType.get(type.id) ?? 0) + 1);
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
      const inner = hole ? padR * hole(ang) + margin * 0.7 + footprint : 0;
      if (edge <= inner) continue;
      const rad = inner + Math.sqrt(rng.next()) * (edge - inner);
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
      // deeper bead under this slot? denser toward the middle so the pad has a "core"
      const toEdge = edge > inner ? (rad - inner) / (edge - inner) : 1;
      if (opts.deeper !== false && rng.chance((opts.deeperChance ?? 0.4) * (1.5 - toEdge))) {
        const dt = pickType(rng, { common: 0.6, big: 1.6, odd: 1.5, special: 1.1 }, typeSkew);
        const dr = Math.min(footprint * 1.02, rng.range(dt.radius[0], dt.radius[1]) * s);
        const dcolor = rng.pick(dt.colors);
        const drot = dt.shape === "circle" ? 0 : rng.range(-Math.PI, Math.PI);
        const deepBead = makeBead(dt, dcolor, Math.max(dr, 7 * s), drot, 1, slot, x, y);
        deepBead.slotR = footprint;
        beads.push(deepBead);
      }
      slot++;
      ok = true;
    }
  }

  // the bead nearest the centre may be a rare (ribbon knot)
  if (opts.rareCenterChance && rng.chance(opts.rareCenterChance)) {
    const surface = beads.filter((b) => b.layer === 0);
    const c = surface.reduce((best, b) => (Math.hypot(b.rx, b.ry) < Math.hypot(best.rx, best.ry) ? b : best), surface[0]);
    if (c) {
      const rare = rng.pick(BEAD_TYPES.filter((t) => t.rarity === "rare"));
      c.type = rare;
      c.color = rng.pick(rare.colors);
      c.rot = 0;
    }
  }

  // the hidden object: one big deep bead under a slot near the middle, replacing that slot's deeper bead
  if (opts.hiddenObject) {
    const ht = HIDDEN_TYPES.find((t) => t.id === opts.hiddenObject) ?? ULTRA_TYPES.find((t) => t.id === opts.hiddenObject);
    if (ht) {
      const surface = beads.filter((b) => b.layer === 0);
      const near = surface
        .map((b) => ({ b, d: Math.hypot(b.rx, b.ry) }))
        .sort((a, c) => a.d - c.d)
        .slice(0, Math.max(1, Math.floor(surface.length * 0.3)));
      if (near.length) {
        const host = rng.pick(near).b;
        for (let i = beads.length - 1; i >= 0; i--) if (beads[i].slot === host.slot && beads[i].layer === 1) beads.splice(i, 1);
        const hr = rng.range(ht.radius[0], ht.radius[1]) * s;
        const hb = makeBead(ht, rng.pick(ht.colors), hr, ht.shape === "circle" ? 0 : rng.range(-0.5, 0.5), 1, host.slot, host.rx, host.ry);
        hb.hidden = true;
        hb.slotR = host.radius;
        beads.push(hb);
      }
    }
  }
  // once in a very long while an ordinary deep bead is something else entirely
  if (opts.ultraChance && rng.chance(opts.ultraChance)) {
    const deep = beads.filter((b) => b.layer === 1 && !b.hidden);
    if (deep.length) {
      const b = rng.pick(deep);
      const ut = rng.pick(ULTRA_TYPES);
      b.type = ut;
      b.color = rng.pick(ut.colors);
      b.radius = Math.max(b.radius, rng.range(ut.radius[0], ut.radius[1]) * s * 0.8);
      b.rot = 0;
      b.hidden = true;
    }
  }
  return beads;
}

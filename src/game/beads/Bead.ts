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
  /** Exact visible size at release, blended into the flight without a jump. */
  releaseScale?: number;
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
  const pool = BEAD_TYPES.filter((t) => t.rarity === rarity && (t.pick ?? 1) > 0);
  return rng.weighted(pool, (t) => (typeSkew[t.id] ?? 1) * (t.pick ?? 1));
}

/** Break the repeated-sticker look without making the shared top-left light
 * incoherent. Round glass/pearls only roll a little; faceted metal may turn
 * freely, while shaped charms keep their existing full rotation. */
function beadRotation(type: BeadType, rng: Rng, ordinal = 0) {
  if (type.shape !== "circle" || type.material === "metal") return rng.range(-Math.PI, Math.PI);
  if (type.material === "glass" || type.material === "pearl") {
    // Golden-ratio stepping prevents two consecutive photographic spheres
    // from accidentally receiving the same baked-highlight direction.
    const turn = (ordinal * 0.61803398875 + rng.next() * 0.18) % 1;
    return (turn - 0.5) * 1.1;
  }
  return rng.range(-0.24, 0.24);
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
  /** safe inset from the outer silhouette, as a fraction of pad radius */
  edgeInset?: number;
  /** reserved pad-local pockets (x/R, y/R) filled with small surface beads */
  smallFillZones?: { x: number; y: number }[];
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
  /** chance that this pad carries one 왕비즈 hidden below a surface bead */
  kingChance?: number;
}

export function generatePad(padR: number, rng: Rng, opts: PadOptions = {}): Bead[] {
  const s = padR / REF_PAD_R;
  const surfaceCount = opts.surface ?? 52;
  const boundary = opts.boundary ?? (() => 1);
  const hole = opts.hole;
  const margin = padR * (opts.edgeInset ?? 0.16);
  const skew = { common: 1.25, big: 0.7, odd: 0.8, ...(opts.raritySkew ?? {}) } as Partial<Record<Rarity, number>>;
  const typeSkew = opts.typeSkew ?? {};
  const gap = (opts.spacing ?? 4.5) * s;
  const smallFillTypes = BEAD_TYPES.filter((type) => type.id === "tiny" || type.id === "marble");

  const clearsVisibleRim = (x: number, y: number, footprint: number) => {
    if (opts.edgeInset === undefined) return true;
    // Ribbon has a broad raised inner rim. Clear that visible band, not merely
    // the mathematical outer silhouette. Sampling the complete circumference
    // also protects the steep diagonal sides of the bow.
    const visualBand = padR * 0.13;
    const probeR = footprint + gap * 0.5;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const px = x + Math.cos(a) * probeR;
      const py = y + Math.sin(a) * probeR;
      const theta = Math.atan2(py, px);
      if (Math.hypot(px, py) > padR * boundary(theta) - visualBand) return false;
    }
    return true;
  };

  // choose types first, biggest first for packing
  const picks: { type: BeadType; radius: number; rot: number }[] = [];
  // no single type may crowd the surface (a pad of ten identical crystals looks like a pattern)
  const perType = new Map<string, number>();
  const cap = Math.max(3, Math.ceil(surfaceCount * 0.26));
  for (let i = 0; i < surfaceCount; i++) {
    const forced = opts.forceTypes?.length ? BEAD_TYPES.find((t) => t.id === opts.forceTypes![i % opts.forceTypes!.length]) : undefined;
    let type = forced ?? pickType(rng, skew, typeSkew);
    const typeCap = (t: BeadType) => t.id === "pearl" ? Math.min(4, cap) : cap;
    for (let k = 0; !forced && k < 8 && (perType.get(type.id) ?? 0) >= typeCap(type); k++) type = pickType(rng, skew, typeSkew);
    if (!forced && type.id === "pearl" && (perType.get(type.id) ?? 0) >= typeCap(type)) {
      type = BEAD_TYPES.find((candidate) => candidate.id === "bigmatte")!;
    }
    const ordinal = perType.get(type.id) ?? 0;
    perType.set(type.id, ordinal + 1);
    // The photographed pearl is visually prominent, so five near-identical
    // copies read as a stamp. Spread repeats across the existing radius range
    // while keeping the hit radius and rendered size identical.
    const pearlT = (ordinal * 0.37 + rng.next() * 0.28) % 1;
    const radius = (type.id === "pearl"
      ? type.radius[0] + (type.radius[1] - type.radius[0]) * pearlT
      : rng.range(type.radius[0], type.radius[1])) * s;
    picks.push({ type, radius, rot: beadRotation(type, rng, ordinal) });
  }
  const king = opts.deeper !== false && opts.kingChance && rng.chance(opts.kingChance)
    ? BEAD_TYPES.find((t) => t.id === "king") : undefined;
  const kingRadius = king ? rng.range(king.radius[0], king.radius[1]) * s : 0;
  picks.sort((a, b) => b.radius - a.radius);

  const beads: Bead[] = [];
  const placed: { x: number; y: number; r: number; material: BeadType["material"] }[] = [];
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
      if (!clearsVisibleRim(x, y, footprint)) clear = false;
      if (!clear) continue;
      // Leave the requested accent pockets available for their small beads;
      // otherwise a random large bead can consume the space first.
      for (const zone of opts.smallFillZones ?? []) {
        const zx = zone.x * padR;
        const zy = zone.y * padR;
        if (Math.hypot(zx - x, zy - y) < footprint + 11 * s + gap * 0.75) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      for (const q of placed) {
        const pearlGap = p.type.material === "pearl" && q.material === "pearl"
          ? Math.min(q.r, footprint) * 0.65
          : 0;
        if (Math.hypot(q.x - x, q.y - y) < q.r + footprint + gap + pearlGap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      placed.push({ x, y, r: footprint, material: p.type.material });
      const color = rng.pick(p.type.colors);
      const rot = p.rot;
      beads.push(makeBead(p.type, color, p.radius, rot, 0, slot, x, y));
      // deeper bead under this slot? denser toward the middle so the pad has a "core"
      const toEdge = edge > inner ? (rad - inner) / (edge - inner) : 1;
      if (opts.deeper !== false && rng.chance((opts.deeperChance ?? 0.4) * (1.5 - toEdge))) {
        const dt = pickType(rng, { common: 0.6, big: 1.6, odd: 1.5, special: 1.1 }, typeSkew);
        const dr = Math.min(footprint * 1.02, rng.range(dt.radius[0], dt.radius[1]) * s);
        const dcolor = rng.pick(dt.colors);
        const drot = beadRotation(dt, rng, slot);
        const deepBead = makeBead(dt, dcolor, Math.max(dr, 7 * s), drot, 1, slot, x, y);
        deepBead.slotR = footprint;
        beads.push(deepBead);
      }
      slot++;
      ok = true;
    }
  }

  // Purposeful little accents for unusually shaped pads. They use normal
  // beads and hit areas; only their empty pockets are authored. If jittered
  // placement cannot remain clear, skip instead of forcing an overlap.
  for (const [index, zone] of (opts.smallFillZones ?? []).entries()) {
    const type = smallFillTypes[index % smallFillTypes.length];
    if (!type) break;
    const radius = rng.range(type.radius[0], type.radius[0] + (type.radius[1] - type.radius[0]) * 0.38) * s;
    const footprint = radius;
    let added = false;
    for (let tries = 0; tries < 24 && !added; tries++) {
      const jitter = tries === 0 ? 0 : padR * 0.018;
      const x = zone.x * padR + rng.range(-jitter, jitter);
      const y = zone.y * padR + rng.range(-jitter, jitter);
      if (!clearsVisibleRim(x, y, footprint)) continue;
      if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + footprint + gap * 0.75)) continue;
      placed.push({ x, y, r: footprint, material: type.material });
      beads.push(makeBead(type, rng.pick(type.colors), radius, beadRotation(type, rng, index), 0, slot++, x, y));
      added = true;
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
        const hb = makeBead(ht, rng.pick(ht.colors), hr, beadRotation(ht, rng), 1, host.slot, host.rx, host.ry);
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
  // The giant is a discovery, never a surface pick. Keep existing treasures
  // intact and prefer an empty deep slot so no ordinary bead is replaced.
  if (king) {
    const surface = beads.filter((b) => b.layer === 0);
    const empty = surface.filter((host) => !beads.some((b) => b.slot === host.slot && b.layer === 1));
    const eligible = empty.length ? empty : surface.filter((host) =>
      !beads.some((b) => b.slot === host.slot && b.layer === 1 && b.hidden));
    const near = eligible.sort((a, b) => Math.hypot(a.rx, a.ry) - Math.hypot(b.rx, b.ry))
      .slice(0, Math.max(1, Math.ceil(eligible.length * 0.3)));
    if (near.length) {
      const host = rng.pick(near);
      for (let i = beads.length - 1; i >= 0; i--) {
        if (beads[i].slot === host.slot && beads[i].layer === 1) beads.splice(i, 1);
      }
      const buried = makeBead(king, rng.pick(king.colors), kingRadius, beadRotation(king, rng), 1, host.slot, host.rx, host.ry);
      buried.hidden = true;
      buried.slotR = host.radius;
      beads.push(buried);
    }
  }
  // Independent random angles can cluster (several hearts pointing the same
  // way). Keep a random first angle, then spread repeats around the circle.
  // Reuse existing angles as jitter: no extra RNG calls or layout/odds changes.
  const orientations = new Map<string, { phase: number; count: number }>();
  for (const bead of beads) {
    if (bead.type.shape === "circle") continue;
    const group = orientations.get(bead.type.id) ?? { phase: bead.rot, count: 0 };
    const period = bead.type.shape === "star" ? Math.PI * 2 / 5
      : bead.type.shape === "oval" ? Math.PI : Math.PI * 2;
    bead.rot = group.phase + group.count * period * 0.61803398875 + Math.sin(bead.rot) * period * 0.025;
    bead.rot = Math.atan2(Math.sin(bead.rot), Math.cos(bead.rot));
    group.count++;
    orientations.set(bead.type.id, group);
  }
  return beads;
}

import type { Rarity } from "../beads/BeadTypes";

/**
 * A pad is data. Every pad shares the same gel physics, pull state machine,
 * mesh renderer and bead system – a PadType only says *what shape*, *what
 * colour*, *how soft*, *which beads* and *what is hidden inside*.
 *
 * Silhouettes are radial functions r(θ) (multiplier of the pad radius R, y
 * down) plus an optional inner hole – enough for clouds, flowers, rings,
 * paws, bows, shells, cherries and stars while keeping one deformation path.
 */
export interface BeadPreset {
  /** surface bead count */
  surface: number;
  /** rarity weight multipliers */
  raritySkew?: Partial<Record<Rarity, number>>;
  /** per-type weight multipliers (within a rarity) */
  typeSkew?: Record<string, number>;
  /** the bead closest to the centre is upgraded to a rare with this chance */
  rareCenterChance?: number;
}

export interface PadType {
  id: string;
  name: string;
  /** outer silhouette, r(θ) as multiplier of R */
  outline: (theta: number) => number;
  /** optional inner hole, r(θ) as multiplier of R */
  hole?: (theta: number) => number;
  /** organic noise amplitude added to the outline (default 0.02) */
  noise?: number;
  gelColor: { r: number; g: number; b: number };
  /** 1 = current default; >1 more see-through */
  transparency: number;
  /** slab thickness multiplier */
  thickness: number;
  /** finger dimple/drag response multiplier – "말랑함" */
  softness: number;
  /** how far/strongly the surface follows a drag – "잘 늘어남" */
  stretch: number;
  /** pop recoil / whole-pad jiggle multiplier */
  wobble: number;
  /** how much a pull on one spot is felt across the whole pad (cherry: the other lobe sways) */
  coupling?: number;
  /** centre visibly thicker (denser colour in the middle instead of the rim) */
  centerThick?: boolean;
  /**
   * local grip multiplier by normalised pad position (x/R, y/R): <1 pops
   * easier (thin petal tips, toes), >1 holds harder (a knot, a thick centre).
   * Keep the field to ONE idea per pad.
   */
  resistance?: (xn: number, yn: number) => number;
  /** overall grip multiplier for the pad */
  grip: number;
  beads: BeadPreset;
  /** bead type id hidden deep in the pad, larger than the rest, revealed as the pad empties */
  hiddenObject?: string;
  /** what the NEXT preview hints at */
  hint?: { color: string; label: string };
  /** emoji-free tiny glyph for the 3-choice hook later */
  glyph: string;
}

const TAU = Math.PI * 2;
const sm = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** gaussian bump in angle space, wraps around */
const bump = (th: number, at: number, width: number) => {
  let d = ((th - at) % TAU + TAU * 1.5) % TAU - Math.PI;
  d /= width;
  return Math.exp(-d * d);
};

export const PADS: readonly PadType[] = [
  {
    id: "cloud",
    name: "구름",
    glyph: "☁",
    outline: (th) => 1 + (0.072 + 0.02 * Math.sin(th + 2.1)) * Math.cos(th * 5 + 0.4) + 0.026 * Math.sin(th * 2 + 1.7),
    noise: 0.014,
    gelColor: { r: 238, g: 200, b: 226 },
    transparency: 1,
    thickness: 1,
    softness: 1.15,
    stretch: 1.2,
    wobble: 1.1,
    grip: 0.92,
    beads: { surface: 52, raritySkew: { common: 1.3, big: 0.7 } },
    hiddenObject: "bigglass",
    hint: { color: "#cfe8ff", label: "유리알" },
  },
  {
    id: "flower",
    name: "꽃",
    glyph: "✿",
    outline: (th) => 0.86 + 0.17 * Math.pow(Math.max(0, Math.cos(th * 6 + 0.3)), 0.8) - 0.02 * Math.cos(th * 6 + 0.3),
    noise: 0.01,
    gelColor: { r: 226, g: 208, b: 240 },
    transparency: 1.05,
    thickness: 0.95,
    softness: 1,
    stretch: 1,
    wobble: 1,
    centerThick: true,
    // petal tips are thin → beads out there let go a little sooner
    resistance: (xn, yn) => {
      const rn = Math.hypot(xn, yn);
      return rn > 0.72 ? 0.82 : rn < 0.3 ? 1.1 : 1;
    },
    grip: 1,
    beads: { surface: 50, typeSkew: { flower: 4 }, raritySkew: { special: 1.6 } },
    hiddenObject: "candystar",
    hint: { color: "#fff0b8", label: "별사탕" },
  },
  {
    id: "donut",
    name: "도넛",
    glyph: "◎",
    outline: (th) => 1 + 0.03 * Math.sin(th * 3 + 0.8) + 0.02 * Math.sin(th * 5 + 2.2),
    hole: (th) => 0.36 + 0.015 * Math.sin(th * 4 + 1.1),
    noise: 0.012,
    gelColor: { r: 246, g: 206, b: 190 },
    transparency: 1.05,
    thickness: 1.1,
    softness: 0.95,
    stretch: 0.95,
    wobble: 1,
    grip: 1,
    beads: { surface: 46, raritySkew: { big: 1.2 } },
    hiddenObject: "key",
    hint: { color: "#f3d27a", label: "열쇠" },
  },
  {
    id: "paw",
    name: "발바닥",
    glyph: "🐾",
    outline: (th) => {
      // big pad, four toes across the top (θ = -π/2 is up)
      let r = 0.8 - 0.08 * Math.max(0, Math.sin(th)) ** 2;
      for (const a of [-1.15, -0.5, 0.5, 1.15]) r += 0.36 * bump(th, -Math.PI / 2 + a * 0.62, 0.2) * (Math.abs(a) > 1 ? 0.88 : 1);
      return r;
    },
    noise: 0.012,
    gelColor: { r: 244, g: 210, b: 220 },
    transparency: 0.9,
    thickness: 1,
    softness: 1.05,
    stretch: 1.05,
    wobble: 1,
    // toes are soft and let go; the centre pad is chewier
    resistance: (xn, yn) => (yn < -0.55 ? 0.8 : Math.hypot(xn, yn) < 0.4 ? 1.12 : 1),
    grip: 1,
    beads: { surface: 48, typeSkew: { heart: 2 } },
    hiddenObject: "eye",
    hint: { color: "#d9e7f5", label: "눈알" },
  },
  {
    id: "ribbon",
    name: "리본",
    glyph: "🎀",
    outline: (th) => {
      const c = Math.abs(Math.cos(th));
      // two wings, a knot in the middle
      return 0.4 + 0.66 * Math.pow(c, 0.55) + 0.05 * bump(th, 0, 0.5) + 0.05 * bump(th, Math.PI, 0.5);
    },
    noise: 0.012,
    gelColor: { r: 240, g: 196, b: 210 },
    transparency: 1,
    thickness: 1,
    softness: 1,
    stretch: 1.1,
    wobble: 1,
    centerThick: true,
    // the knot holds on hardest, the wings are thin and easy
    resistance: (xn) => (Math.abs(xn) < 0.28 ? 1.28 : Math.abs(xn) > 0.65 ? 0.88 : 1),
    grip: 1,
    beads: { surface: 46, rareCenterChance: 0.55, typeSkew: { gold: 2.5 } },
    hiddenObject: "bigopal",
    hint: { color: "#f2e6ff", label: "오팔" },
  },
  {
    id: "shell",
    name: "조개",
    glyph: "🐚",
    outline: (th) => {
      const down = Math.max(0, Math.sin(th)); // y down → hinge at the bottom
      const ridges = 0.045 * Math.cos(th * 7 + 0.2) * (1 - sm(clamp01(down * 1.4)));
      return 0.98 - 0.42 * Math.pow(down, 1.6) + ridges;
    },
    noise: 0.008,
    gelColor: { r: 242, g: 232, b: 238 },
    transparency: 1.0,
    thickness: 1.05,
    softness: 0.95,
    stretch: 0.95,
    wobble: 0.9,
    grip: 1.02,
    beads: { surface: 46, typeSkew: { pearl: 3, shell: 2 }, raritySkew: { big: 1.4 } },
    hiddenObject: "bigpearl",
    hint: { color: "#ffffff", label: "진주" },
  },
  {
    id: "cherry",
    name: "체리",
    glyph: "🍒",
    // two lobes joined by a short waist
    outline: (th) => 0.34 + 0.72 * Math.pow(Math.abs(Math.cos(th)), 0.75),
    noise: 0.012,
    gelColor: { r: 246, g: 196, b: 204 },
    transparency: 1.05,
    thickness: 1,
    softness: 1.05,
    stretch: 1,
    wobble: 1.05,
    coupling: 1,
    grip: 1,
    beads: { surface: 44, typeSkew: { cherry: 3 } },
    hiddenObject: "minicherry",
    hint: { color: "#e2445c", label: "체리" },
  },
  {
    id: "star",
    name: "별",
    glyph: "⭐",
    outline: (th) => 0.8 + 0.22 * Math.cos(th * 5 - Math.PI / 2),
    noise: 0.01,
    gelColor: { r: 214, g: 214, b: 244 },
    transparency: 1,
    thickness: 1,
    softness: 1,
    stretch: 1,
    wobble: 1,
    centerThick: true,
    // thin points, thick middle
    resistance: (xn, yn) => {
      const rn = Math.hypot(xn, yn);
      return rn > 0.75 ? 0.8 : rn < 0.35 ? 1.15 : 1;
    },
    grip: 1,
    beads: { surface: 48, typeSkew: { star: 3 } },
    hiddenObject: "duck",
    hint: { color: "#fff6c8", label: "오리" },
  },
];

export const padById = (id: string) => PADS.find((p) => p.id === id);

/** draw a pad's silhouette (with hole) centred at (0,0), radius R, into ctx */
export function silhouettePath(ctx: CanvasRenderingContext2D, pad: PadType, R: number, n = 96) {
  ctx.beginPath();
  const loop = (f: (th: number) => number) => {
    const pt = (i: number) => {
      const th = (i / n) * TAU;
      const r = R * f(th);
      return { x: Math.cos(th) * r, y: Math.sin(th) * r };
    };
    let p0 = pt(n - 1);
    let p1 = pt(0);
    ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    for (let i = 0; i < n; i++) {
      p0 = pt(i);
      p1 = pt(i + 1);
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }
    ctx.closePath();
  };
  loop(pad.outline);
  if (pad.hole) loop(pad.hole);
}

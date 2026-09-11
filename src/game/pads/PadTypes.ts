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
  /** chance of one 왕비즈 on this pad (default 0.4) */
  kingChance?: number;
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
  /**
   * hidden object actually buried this time (rolled from HIDDEN_POOLS when the
   * pad is opened – the same pad hides different things on different visits)
   */
  hiddenObject?: string;
  /** what the NEXT preview hints at */
  hint?: { color: string; label: string };
  /** emoji-free tiny glyph for the 3-choice hook later */
  glyph: string;
  /** set on a rolled variant: which base pad it is and how rare */
  variantOf?: string;
  tier?: "rare" | "super";
  /** how visible the buried object is (1 = default; <1 harder to spot) */
  hiddenVisibility?: number;
}

/**
 * Pad variants: the same toy, once in a while, a little different – a touch
 * more transparent, a few more rare beads, a slightly different grip. One
 * idea per variant, never a new rule set.
 */
export interface PadVariant {
  id: string;
  name: string;
  tier: "rare" | "super";
  patch: Partial<Pick<PadType, "gelColor" | "transparency" | "grip" | "softness" | "hiddenVisibility" | "hint">> & {
    raritySkew?: Partial<Record<Rarity, number>>;
  };
}

export const VARIANTS: Record<string, PadVariant[]> = {
  cloud: [
    { id: "glasscloud", name: "유리 구름", tier: "rare", patch: { gelColor: { r: 222, g: 232, b: 246 }, transparency: 1.35 } },
    { id: "softcloud", name: "말랑 구름", tier: "rare", patch: { softness: 1.35 } },
  ],
  flower: [
    { id: "pearlflower", name: "펄 꽃", tier: "rare", patch: { gelColor: { r: 244, g: 236, b: 246 }, transparency: 0.85 } },
    { id: "luckyflower", name: "행운 꽃", tier: "rare", patch: { raritySkew: { rare: 2.2 } } },
  ],
  donut: [
    { id: "sugardonut", name: "슈가 도넛", tier: "rare", patch: { gelColor: { r: 248, g: 240, b: 236 }, transparency: 0.95 } },
    { id: "chewydonut", name: "쫀득 도넛", tier: "rare", patch: { grip: 1.18 } },
  ],
  paw: [
    { id: "milkypaw", name: "밀키 발바닥", tier: "rare", patch: { gelColor: { r: 248, g: 226, b: 232 }, transparency: 0.85 } },
    { id: "loosepaw", name: "헐렁 발바닥", tier: "rare", patch: { grip: 0.86 } },
  ],
  ribbon: [
    { id: "glassribbon", name: "유리 리본", tier: "rare", patch: { gelColor: { r: 230, g: 236, b: 248 }, transparency: 1.4 } },
    { id: "luckyribbon", name: "행운 리본", tier: "rare", patch: { raritySkew: { rare: 2.2 } } },
  ],
  shell: [
    { id: "pearlshell", name: "펄 조개", tier: "rare", patch: { gelColor: { r: 246, g: 240, b: 244 }, transparency: 0.8 } },
    { id: "clearshell", name: "엄청 투명한 조개", tier: "rare", patch: { transparency: 1.45 } },
    { id: "thickshell", name: "조금 두꺼운 조개", tier: "rare", patch: { grip: 1.15 } },
  ],
  cherry: [
    { id: "jellycherry", name: "젤리 체리", tier: "rare", patch: { softness: 1.3 } },
    { id: "clearcherry", name: "유리 체리", tier: "rare", patch: { gelColor: { r: 250, g: 210, b: 216 }, transparency: 1.35 } },
  ],
  star: [
    { id: "rainbowstar", name: "무지개 별", tier: "super", patch: { gelColor: { r: 226, g: 220, b: 248 }, transparency: 1.25, raritySkew: { rare: 2.6 }, hint: { color: "#ffe9ff", label: "???" } } },
    { id: "glassstar", name: "유리 별", tier: "rare", patch: { transparency: 1.4 } },
  ],
};

/** merge a variant onto its base pad */
export function applyVariant(base: PadType, v: PadVariant): PadType {
  const { raritySkew, ...rest } = v.patch;
  return {
    ...base,
    ...rest,
    id: `${base.id}:${v.id}`,
    name: v.name,
    variantOf: base.id,
    tier: v.tier,
    beads: { ...base.beads, raritySkew: { ...(base.beads.raritySkew ?? {}), ...(raritySkew ?? {}) } },
  };
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

/**
 * A polar outline from a parametric closed curve: sample it, sort by angle, interpolate.
 * Lets a pad be a shape that has no tidy r(θ) formula (a heart) while staying on the one radial path.
 */
function polarOf(curve: (t: number) => [number, number], n = 512): (theta: number) => number {
  const pts: { a: number; r: number }[] = [];
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = curve((i / n) * TAU);
    const r = Math.hypot(x, y);
    maxR = Math.max(maxR, r);
    pts.push({ a: ((Math.atan2(y, x) % TAU) + TAU) % TAU, r });
  }
  pts.sort((p, q) => p.a - q.a);
  const table: number[] = [];
  const N = 360;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU;
    // nearest sample on either side, angular interpolation (wraps)
    let lo = pts.length - 1;
    for (let i = 0; i < pts.length; i++) if (pts[i].a <= a) lo = i;
    const hi = (lo + 1) % pts.length;
    const a0 = pts[lo].a, a1 = pts[hi].a + (hi === 0 ? TAU : 0), aa = a < a0 ? a + TAU : a;
    const t = a1 > a0 ? clamp01((aa - a0) / (a1 - a0)) : 0;
    table.push((pts[lo].r + (pts[hi].r - pts[lo].r) * t) / maxR);
  }
  return (theta: number) => {
    const u = (((theta % TAU) + TAU) % TAU) / TAU * N;
    const i = Math.floor(u) % N, j = (i + 1) % N, f = u - Math.floor(u);
    return table[i] * (1 - f) + table[j] * f;
  };
}
/** a plump heart: the classic curve blended a third toward a circle so the lobes stay round (y down, tip at the bottom) */
const heartR = (() => {
  const h = polarOf((t) => [16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) + 1.5]);
  return (th: number) => 0.7 * h(th) + 0.3 * 0.92;
})();

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
    beads: { surface: 46, rareCenterChance: 0.09, typeSkew: { gold: 2.5 } },
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
    hint: { color: "#fff6c8", label: "오리" },
  },

  {
    id: "heart",
    name: "하트",
    glyph: "♥",
    outline: heartR,
    noise: 0.008,
    gelColor: { r: 255, g: 168, b: 178 },
    transparency: 1,
    thickness: 1.05,
    softness: 1.2,
    stretch: 1.15,
    wobble: 1.15,
    // the dip between the lobes is thin: pops a little easier there
    resistance: (xn, yn) => (yn < -0.35 && Math.abs(xn) < 0.22 ? 0.85 : 1),
    grip: 1,
    beads: { surface: 50, typeSkew: { heart: 3, cherry: 1.6 }, raritySkew: { special: 1.5 } },
    hint: { color: "#ffd0d8", label: "하트" },
  },
  {
    id: "cat",
    name: "고양이",
    glyph: "🐱",
    // a round face with two pointed ears at the top corners
    outline: (th) => 0.9 + 0.44 * Math.pow(bump(th, -2.32, 0.24), 0.7) + 0.44 * Math.pow(bump(th, -0.82, 0.24), 0.7) + 0.03 * Math.cos(th * 2),
    noise: 0.008,
    gelColor: { r: 222, g: 220, b: 234 },
    transparency: 1.1,
    thickness: 0.95,
    softness: 1,
    stretch: 1.05,
    wobble: 1,
    // ear tips are thin
    resistance: (_xn, yn) => (yn < -0.85 ? 0.78 : 1),
    grip: 1,
    beads: { surface: 48, typeSkew: { smile: 2, gem: 1.6 } },
    hint: { color: "#e8e6f4", label: "고양이" },
  },
  {
    id: "bear",
    name: "곰돌이",
    glyph: "🐻",
    // a round face with two round ears
    outline: (th) => 0.92 + 0.24 * bump(th, -2.36, 0.36) + 0.24 * bump(th, -0.78, 0.36) + 0.02 * Math.cos(th * 2 + 0.3),
    noise: 0.01,
    gelColor: { r: 236, g: 206, b: 170 },
    transparency: 0.95,
    thickness: 1.1,
    softness: 1.05,
    stretch: 1,
    wobble: 1.05,
    centerThick: true,
    grip: 1.02,
    beads: { surface: 50, typeSkew: { gold: 2, gem: 1.4, pearl: 1.3 }, kingChance: 0.5 },
    hint: { color: "#f3dcc0", label: "곰돌이" },
  },
];

/** base pad by id ("shell" or a variant id "shell:pearlshell" → the shell) */
export const padById = (id: string) => PADS.find((p) => p.id === id.split(":")[0]);

/** full pad for an id, variants included ("shell:pearlshell" → the pearl shell) */
export function resolvePad(id: string): PadType | undefined {
  const [baseId, vId] = id.split(":");
  const base = PADS.find((p) => p.id === baseId);
  if (!base) return undefined;
  if (!vId) return base;
  const v = (VARIANTS[baseId] ?? []).find((x) => x.id === vId);
  return v ? applyVariant(base, v) : base;
}

/** how many variants a base pad has (for the collection sheet) */
export const variantCount = (baseId: string) => (VARIANTS[baseId] ?? []).length;

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

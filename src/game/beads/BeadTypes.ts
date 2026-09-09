/**
 * Bead catalogue. Every value that changes how a bead *feels* lives here so
 * tuning the hand-feel is a data edit, not a code edit.
 *
 * Distances are in px at a reference pad radius of 170px and are scaled by
 * the live pad size, so a small 360px phone and a tablet feel the same.
 */
export type BeadShape = "circle" | "star" | "heart" | "flower" | "oval" | "disc" | "smile" | "cherry" | "eye" | "key" | "duck" | "crown";
export type BeadMaterial = "plastic" | "glass" | "pearl" | "metal" | "shell";
export type Rarity = "common" | "big" | "odd" | "special" | "rare" | "hidden" | "ultra";
export type PopSound = "pok" | "ssok" | "pong" | "tok" | "ting";

export interface BeadType {
  id: string;
  name: string;
  shape: BeadShape;
  material: BeadMaterial;
  rarity: Rarity;
  score: number;
  /** base radius range (px @ ref pad) */
  radius: [number, number];
  colors: readonly string[];
  /** stage 1: finger travels this far while the bead barely moves (gel stretches) */
  grip: number;
  /** stage 2: extra travel during which the bead creeps out until it pops */
  pull: number;
  /** 0..1 – how reluctantly the bead creeps in stage 2 (curve exponent) */
  friction: number;
  /** finger speed (px/s) needed at the threshold to actually pop. Slow pulls just stretch. */
  minSpeed: number;
  /** relative mass: fly time, recoil, sound pitch */
  mass: number;
  /** pop kick distance toward the finger (px) */
  bounce: number;
  /** star-like beads: progress fraction at which an edge "catches" and holds for a moment */
  catch?: number;
  /** long beads: pulling off-axis is harder, wiggling the pull direction frees them */
  needsWiggle?: boolean;
  sound: PopSound;
  /** elongation for oval shapes (major/minor) */
  aspect?: number;
}

// candy tones: clearly coloured, still soft – they have to stay pretty under a layer of gel
const PASTEL = ["#6fbfff", "#ff8fc4", "#b08cff", "#6fe0ae", "#ffe05c", "#ffab6a", "#ffffff", "#ff7fa8", "#5fd8e8"];
const GLASS = ["#7fcdff", "#8ff0d0", "#ffa6d2", "#c3a8ff", "#ffe48a", "#a0f0ff"];
const MATTE_BIG = ["#ff92bc", "#7fb8ff", "#bf9dff", "#ffcf4d", "#7fe0c0", "#ff9d7a"];

export const BEAD_TYPES: readonly BeadType[] = [
  // ─── common (60%) ───────────────────────────────────────────────
  {
    id: "tiny",
    name: "작은 비즈",
    shape: "circle",
    material: "plastic",
    rarity: "common",
    score: 1,
    radius: [8.5, 11.5],
    colors: PASTEL,
    grip: 9,
    pull: 20,
    friction: 0.25,
    minSpeed: 90,
    mass: 0.55,
    bounce: 13,
    sound: "pok",
  },
  {
    id: "marble",
    name: "투명 구슬",
    shape: "circle",
    material: "glass",
    rarity: "common",
    score: 1,
    radius: [9.5, 12.5],
    colors: GLASS,
    grip: 10,
    pull: 22,
    friction: 0.3,
    minSpeed: 110,
    mass: 0.75,
    bounce: 15,
    sound: "tok",
  },
  // ─── big (20%) ──────────────────────────────────────────────────
  {
    id: "pearl",
    name: "큰 진주",
    shape: "circle",
    material: "pearl",
    rarity: "big",
    score: 1,
    radius: [15, 18.5],
    colors: ["#fbf3ee", "#f6e9f0", "#eef1f8"],
    grip: 16,
    pull: 44,
    friction: 0.65,
    minSpeed: 220,
    mass: 1.7,
    bounce: 24,
    sound: "pong",
  },
  {
    id: "bigmatte",
    name: "큰 비즈",
    shape: "circle",
    material: "plastic",
    rarity: "big",
    score: 1,
    radius: [13.5, 16.5],
    colors: MATTE_BIG,
    grip: 13,
    pull: 34,
    friction: 0.5,
    minSpeed: 170,
    mass: 1.25,
    bounce: 19,
    sound: "pok",
  },
  // ─── odd shapes (10%) ───────────────────────────────────────────
  {
    id: "star",
    name: "납작한 별",
    shape: "star",
    material: "plastic",
    rarity: "odd",
    score: 1,
    radius: [13, 15.5],
    colors: ["#ffdf5c", "#ffa2c6", "#8fd0ff", "#ffffff"],
    grip: 11,
    pull: 30,
    friction: 0.45,
    minSpeed: 150,
    mass: 0.9,
    bounce: 16,
    catch: 0.5,
    sound: "tok",
  },
  {
    id: "long",
    name: "길쭉한 비즈",
    shape: "oval",
    material: "glass",
    rarity: "odd",
    score: 1,
    radius: [10, 12.5],
    aspect: 1.75,
    colors: ["#8ff0d0", "#ffa6d2", "#7fcdff", "#c3a8ff"],
    grip: 11,
    pull: 28,
    friction: 0.4,
    minSpeed: 140,
    mass: 0.95,
    bounce: 17,
    needsWiggle: true,
    sound: "tok",
  },
  {
    id: "shell",
    name: "자개 조각",
    shape: "disc",
    material: "shell",
    rarity: "odd",
    score: 1,
    radius: [12.5, 15],
    colors: ["#f2eef7", "#eaf3f4", "#f8eef0"],
    grip: 12,
    pull: 26,
    friction: 0.35,
    minSpeed: 130,
    mass: 0.7,
    bounce: 15,
    sound: "tok",
  },
  // ─── special (7%) ───────────────────────────────────────────────
  {
    id: "heart",
    name: "하트",
    shape: "heart",
    material: "glass",
    rarity: "special",
    score: 3,
    radius: [12, 14.5],
    colors: ["#ff6fa3", "#ffa6d2", "#ff5c8f"],
    grip: 11,
    pull: 26,
    friction: 0.4,
    minSpeed: 140,
    mass: 0.85,
    bounce: 16,
    sound: "pok",
  },
  {
    id: "flower",
    name: "반투명 꽃",
    shape: "flower",
    material: "plastic",
    rarity: "special",
    score: 3,
    radius: [13, 15.5],
    colors: ["#ffb3d6", "#c9b0ff", "#fff0a0", "#a8dcff"],
    grip: 12,
    pull: 28,
    friction: 0.4,
    minSpeed: 140,
    mass: 0.9,
    bounce: 16,
    catch: 0.4,
    sound: "ssok",
  },
  {
    id: "smile",
    name: "스마일",
    shape: "smile",
    material: "plastic",
    rarity: "special",
    score: 3,
    radius: [11, 13],
    colors: ["#ffe057"],
    grip: 10,
    pull: 24,
    friction: 0.3,
    minSpeed: 120,
    mass: 0.75,
    bounce: 15,
    sound: "pok",
  },
  {
    id: "cherry",
    name: "체리",
    shape: "cherry",
    material: "plastic",
    rarity: "special",
    score: 3,
    radius: [10, 12],
    colors: ["#e2445c"],
    grip: 10,
    pull: 24,
    friction: 0.35,
    minSpeed: 120,
    mass: 0.8,
    bounce: 15,
    sound: "ssok",
  },
  {
    id: "gold",
    name: "금색 비즈",
    shape: "circle",
    material: "metal",
    rarity: "special",
    score: 3,
    radius: [10, 12.5],
    colors: ["#f5c542"],
    grip: 11,
    pull: 26,
    friction: 0.4,
    minSpeed: 150,
    mass: 1.4,
    bounce: 14,
    sound: "tok",
  },
  // ─── rare (3%) ──────────────────────────────────────────────────
  {
    id: "rainbow",
    name: "무지개 유리알",
    shape: "circle",
    material: "glass",
    rarity: "rare",
    score: 10,
    radius: [12, 14.5],
    colors: ["#e4f2ff"],
    grip: 12,
    pull: 30,
    friction: 0.45,
    minSpeed: 150,
    mass: 0.9,
    bounce: 18,
    sound: "ting",
  },
  {
    id: "opal",
    name: "오팔 진주",
    shape: "circle",
    material: "pearl",
    rarity: "rare",
    score: 10,
    radius: [14.5, 17],
    colors: ["#f4eefc"],
    grip: 15,
    pull: 40,
    friction: 0.6,
    minSpeed: 200,
    mass: 1.5,
    bounce: 22,
    sound: "ting",
  },
];

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60,
  big: 20,
  odd: 10,
  special: 7,
  // ≈0.55 plain rares per pad after the 30% smaller pads (≈34 surface + ≈21 deep beads through the
  // weighted picker): a rare should be an "어? 나왔다" roughly every other pad, not a fixture
  rare: 1.15,
  hidden: 0, // never rolled – placed on purpose by the pad
  ultra: 0, // never rolled – tiny fixed chance handled by the layout
};

/**
 * Hidden objects: one per pad, larger than any bead, buried deep and only
 * glimpsed as the pad empties. Not worth points – worth a "what is that?".
 */
const hidden = (t: Omit<BeadType, "rarity" | "score" | "grip" | "pull" | "friction" | "minSpeed" | "bounce"> & Partial<BeadType>): BeadType => ({
  rarity: "hidden",
  score: 0,
  grip: 18,
  pull: 46,
  friction: 0.6,
  minSpeed: 200,
  bounce: 22,
  ...t,
});

export const HIDDEN_TYPES: readonly BeadType[] = [
  hidden({ id: "bigpearl", name: "큰 진주", shape: "circle", material: "pearl", radius: [24, 26], colors: ["#fbf6f2"], mass: 2.6, sound: "pong" }),
  hidden({ id: "minicherry", name: "미니 체리", shape: "cherry", material: "plastic", radius: [19, 21], colors: ["#d9384f"], mass: 1.6, sound: "ssok" }),
  hidden({ id: "duck", name: "작은 투명 오리", shape: "duck", material: "glass", radius: [21, 23], colors: ["#fff3c2"], mass: 1.5, sound: "pok" }),
  hidden({ id: "key", name: "금색 열쇠", shape: "key", material: "metal", radius: [22, 24], colors: ["#e6c25c"], mass: 2.2, sound: "tok" }),
  hidden({ id: "eye", name: "눈알 비즈", shape: "eye", material: "glass", radius: [20, 22], colors: ["#ffffff"], mass: 1.7, sound: "pok" }),
  hidden({ id: "candystar", name: "별사탕", shape: "star", material: "plastic", radius: [22, 24], colors: ["#fff0b8", "#ffd8e6", "#d8f0ff"], mass: 1.4, sound: "tok" }),
  hidden({ id: "smallshell", name: "작은 조개", shape: "disc", material: "shell", radius: [21, 23], colors: ["#f5eef0"], mass: 1.5, sound: "tok" }),
  hidden({ id: "bigopal", name: "오팔", shape: "circle", material: "pearl", radius: [21, 23], colors: ["#f4eefc"], mass: 2, sound: "ting" }),
  hidden({ id: "bigglass", name: "아주 큰 유리알", shape: "circle", material: "glass", radius: [25, 27], colors: ["#dbeeff"], mass: 2.8, sound: "pong" }),
];

/** Ultra-rare: 0.5~1%, any pad, once in a blue moon. "뭐야 이거?" – never a jackpot. */
export const ULTRA_TYPES: readonly BeadType[] = [
  { ...hidden({ id: "crown", name: "왕관 비즈", shape: "crown", material: "metal", radius: [23, 25], colors: ["#f2c94c"], mass: 2.2, sound: "ting" }), rarity: "ultra" },
  { ...hidden({ id: "holostar", name: "홀로그램 별", shape: "star", material: "glass", radius: [23, 25], colors: ["#e8f4ff"], mass: 1.6, sound: "ting" }), rarity: "ultra" },
  { ...hidden({ id: "bigduck", name: "대왕 투명 오리", shape: "duck", material: "glass", radius: [27, 29], colors: ["#fff6d0"], mass: 2.4, sound: "pong" }), rarity: "ultra" },
];

export const byId = (id: string) =>
  BEAD_TYPES.find((t) => t.id === id) ?? HIDDEN_TYPES.find((t) => t.id === id) ?? ULTRA_TYPES.find((t) => t.id === id)!;

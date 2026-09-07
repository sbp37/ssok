/**
 * Bead catalogue. Every value that changes how a bead *feels* lives here so
 * tuning the hand-feel is a data edit, not a code edit.
 *
 * Distances are in px at a reference pad radius of 170px and are scaled by
 * the live pad size, so a small 360px phone and a tablet feel the same.
 */
export type BeadShape = "circle" | "star" | "heart" | "flower" | "oval" | "disc" | "smile" | "cherry";
export type BeadMaterial = "plastic" | "glass" | "pearl" | "metal" | "shell";
export type Rarity = "common" | "big" | "odd" | "special" | "rare";
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

const PASTEL = ["#8ec7f0", "#f6a8c9", "#b8a2e6", "#9fd8b4", "#f6e08a", "#f8b98b", "#ffffff", "#f19ab0"];
const GLASS = ["#a9d6f5", "#bfe3d2", "#f5c6d9", "#d9c9f2", "#f9e2a6"];
const MATTE_BIG = ["#f0a4bd", "#a4c8f0", "#c9b6ec", "#f6d18a", "#a8dcc1"];

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
    colors: ["#f6e08a", "#f8b4c8", "#a9d6f5", "#ffffff"],
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
    colors: ["#bfe3d2", "#f5c6d9", "#a9d6f5", "#d9c9f2"],
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
    colors: ["#f48fb1", "#f5c6d9", "#e57399"],
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
    colors: ["#f8c8dc", "#d9c9f2", "#fff2b3", "#cfe9f7"],
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
    colors: ["#f9dd6b"],
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
    colors: ["#e8c15a"],
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
  rare: 3,
};

export const byId = (id: string) => BEAD_TYPES.find((t) => t.id === id)!;

import { bump, clamp01, sm, TAU } from "./PadTypes";
import type { PadType } from "./PadTypes";

// Canvas angles run clockwise, with the top at -π/2. Every silhouette has
// one positive radius per angle: broad lobes, no curled or hidden branches.
const mapleR = (th: number) => {
  let r = 0.76;
  for (const degrees of [-170, -130, -90, -50, -10]) {
    r += (degrees === -90 ? 0.39 : 0.31) * bump(th, degrees * Math.PI / 180, 0.29);
  }
  return r + 0.13 * bump(th, Math.PI / 2, 0.3);
};

const pumpkinR = (th: number) => {
  const ellipse = 1 / Math.hypot(Math.cos(th) / 1.04, Math.sin(th) / 0.88);
  // Six shallow grooves around the rim; the small top lobe is the stalk.
  let grooves = 0;
  for (let i = 0; i < 6; i++) grooves += 0.04 * bump(th, -Math.PI / 2 + i * TAU / 6, 0.13);
  return ellipse - grooves + 0.16 * bump(th, -Math.PI / 2, 0.19);
};

const snowmanR = (th: number) => {
  // Both overlapping discs contain the origin, so their union stays radial.
  const disc = (cy: number, radius: number) => cy * Math.sin(th)
    + Math.sqrt(radius * radius - cy * cy * Math.cos(th) ** 2);
  const head = disc(-0.43, 0.58), body = disc(0.32, 0.78);
  // Smooth maximum rounds the two neck joins without closing the waist.
  return (head + body + Math.sqrt((head - body) ** 2 + 0.0036)) / 2;
};

const snowflakeR = (th: number) => 0.94 + 0.16 * Math.cos(6 * (th + TAU / 4));

const sakuraR = (th: number) => {
  let r = 0.76;
  for (let i = 0; i < 5; i++) {
    const tip = -Math.PI / 2 + i * TAU / 5;
    // A broad petal with a small rounded cleft splitting its outer tip.
    r += 0.38 * bump(th, tip, 0.36) - 0.13 * bump(th, tip, 0.085);
  }
  return r;
};

const tulipR = (th: number) => {
  const cup = 1 / Math.hypot(Math.cos(th) / 0.94, Math.sin(th) / 0.88);
  let r = cup;
  for (const tip of [-Math.PI / 2 - 0.62, -Math.PI / 2, -Math.PI / 2 + 0.62]) {
    r += 0.25 * bump(th, tip, 0.22);
  }
  return r;
};

const watermelonR = (th: number) => {
  // The origin lies below the cut face and inside the offset round rind. The rind
  // circle is kept to r 1.06 so the slice (~2.0R wide) stays clear of the screen edges.
  const rind = -0.33 * Math.sin(th)
    + Math.sqrt(1.06 ** 2 - 0.33 ** 2 * Math.cos(th) ** 2);
  if (Math.sin(th) >= 0) return rind;
  const face = -0.62 / Math.sin(th);
  // Smooth intersection rounds the two corners of the otherwise flat cut.
  return rind / (1 + (rind / face) ** 32) ** (1 / 32);
};

const icecreamR = (th: number) => {
  const x = Math.cos(th), y = Math.sin(th);
  // Rounded intersection of four half-planes: a short, blunt tapered cone.
  const cone = 1 / (Math.max(0, (x + 0.42 * y) / 0.7) ** 12
    + Math.max(0, (-x + 0.42 * y) / 0.7) ** 12
    + Math.max(0, y / 1.1) ** 12 + Math.max(0, -y / 0.35) ** 12) ** (1 / 12);
  const scoop = -0.35 * y + Math.sqrt(0.87 ** 2 - 0.35 ** 2 * x ** 2);
  const rounded = (cone + scoop + Math.hypot(cone - scoop, 0.06)) / 2;
  // Gentle scallops only around the scoop, fading before the cone.
  return rounded + 0.025 * Math.cos(8 * (th + Math.PI / 2)) * sm(clamp01(-y * 3));
};

/** Monthly limited pads; scheduling can opt in without changing the base catalog. */
export const THEME_PADS: readonly PadType[] = [
  {
    id: "maple", name: "단풍잎", glyph: "♧", outline: mapleR,
    noise: 0.006, gelColor: { r: 246, g: 190, b: 160 },
    transparency: 1, thickness: 0.95, softness: 1.1, stretch: 1.1, wobble: 1.05, grip: 1,
    // The central leaf vein holds more firmly than the broad tips.
    resistance: (x, _y) => 1 + 0.2 * Math.exp(-((x / 0.2) ** 2)),
    beads: { surface: 40, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { flower: 2, star: 1.5 } },
    hint: { color: "#f6bea0", label: "가을빛 비즈" },
  },
  {
    id: "pumpkin", name: "호박", glyph: "◉", outline: pumpkinR,
    noise: 0.006, gelColor: { r: 248, g: 206, b: 150 },
    transparency: 0.95, thickness: 1.1, softness: 1.05, stretch: 1, wobble: 1.1, grip: 1.05,
    // One denser vertical rib through the middle.
    resistance: (x, _y) => 1 + 0.18 * Math.exp(-((x / 0.26) ** 2)),
    beads: { surface: 44, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { pearl: 1.6, marble: 2 } },
    hint: { color: "#f8ce96", label: "호박빛 구슬" },
  },
  {
    id: "snowman", name: "눈사람", glyph: "☃", outline: snowmanR,
    noise: 0.004, gelColor: { r: 236, g: 244, b: 252 },
    transparency: 1.3, thickness: 1, softness: 1.15, stretch: 1.05, wobble: 1.1, grip: 0.98,
    // The narrow neck releases a little more easily.
    resistance: (_x, y) => 1.08 - 0.24 * Math.exp(-(((y + 0.1) / 0.18) ** 2)),
    beads: { surface: 40, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { pearl: 2, marble: 1.6 } },
    hint: { color: "#ecf4fc", label: "눈빛 진주" },
  },
  {
    id: "snowflake", name: "눈송이", glyph: "❄", outline: snowflakeR,
    noise: 0.004, gelColor: { r: 214, g: 232, b: 250 },
    transparency: 1.2, thickness: 0.95, softness: 1.05, stretch: 1.1, wobble: 1.05, grip: 1,
    // The icy centre is denser; all six rounded tips release more easily.
    resistance: (x, y) => 1.16 - 0.28 * sm(clamp01(Math.hypot(x, y))),
    beads: { surface: 42, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { star: 2, gem: 1.6 } },
    hint: { color: "#d6e8fa", label: "얼음빛 별사탕" },
  },
  {
    id: "sakura", name: "벚꽃", glyph: "✿", outline: sakuraR,
    noise: 0.004, gelColor: { r: 250, g: 212, b: 224 },
    transparency: 1.2, thickness: 0.95, softness: 1.15, stretch: 1.1, wobble: 1.05, grip: 0.98,
    // The flower centre holds more firmly than the soft petals.
    resistance: (x, y) => 1.16 - 0.24 * sm(clamp01(Math.hypot(x, y))),
    beads: { surface: 42, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { flower: 2, pearl: 1.6 } },
    hint: { color: "#fad4e0", label: "벚꽃빛 비즈" },
  },
  {
    id: "tulip", name: "튤립", glyph: "♧", outline: tulipR,
    noise: 0.006, gelColor: { r: 248, g: 196, b: 196 },
    transparency: 1, thickness: 1.1, softness: 1.1, stretch: 1.05, wobble: 1.1, grip: 1.05,
    // The rounded base of the cup is a little denser.
    resistance: (_x, y) => 1 + 0.18 * sm(clamp01(y)),
    beads: { surface: 44, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { flower: 2, marble: 1.6 } },
    hint: { color: "#f8c4c4", label: "살구빛 꽃구슬" },
  },
  {
    id: "watermelon", name: "수박", glyph: "◒", outline: watermelonR,
    noise: 0.006, gelColor: { r: 250, g: 190, b: 196 },
    transparency: 1, thickness: 1.1, softness: 1.05, stretch: 1.1, wobble: 1.1, grip: 1,
    centerThick: true,
    // The rounded rind grips more firmly toward the outside.
    resistance: (x, y) => 0.98 + 0.2 * sm(clamp01(Math.hypot(x, y))),
    beads: { surface: 40, edgeInset: 0.16, raritySkew: { common: 2, big: 0.35, odd: 0.5 }, typeSkew: { marble: 2, tiny: 1.4 } },
    hint: { color: "#fabec4", label: "수박빛 구슬" },
  },
  {
    id: "icecream", name: "아이스크림", glyph: "♙", outline: icecreamR,
    noise: 0.004, gelColor: { r: 220, g: 244, b: 232 },
    transparency: 0.95, thickness: 1.05, softness: 1.15, stretch: 1.05, wobble: 1.1, grip: 0.98,
    // The cone holds a little more firmly than the soft scoop.
    resistance: (_x, y) => 0.96 + 0.2 * sm(clamp01((y + 0.1) / 0.9)),
    beads: { surface: 40, edgeInset: 0.16, raritySkew: { common: 1.3, big: 0.6, odd: 0.6 }, typeSkew: { pearl: 2, star: 1.6 } },
    hint: { color: "#dcf4e8", label: "민트빛 별사탕" },
  },
];

import { VARIANTS, type PadType } from "./PadTypes";
import { themeOfPad } from "../rewards/themes";

/**
 * Gel colours. A pad keeps its shape and name but not always its colour: on
 * each opening it may take its own colour or one from this palette, never one
 * that was on the table in the last few pads. Values are the renderer's final
 * silicone colours (bright pastels that stay pastel under the gel shading).
 */
export type RGB = { r: number; g: number; b: number };
const c = (r: number, g: number, b: number): RGB => ({ r, g, b });

/** each everyday pad's own colour (what the collection shows) */
export const OWN_COLORS: Record<string, RGB> = {
  cloud: c(255, 171, 207), flower: c(232, 181, 255), donut: c(255, 197, 158),
  paw: c(180, 240, 210), ribbon: c(174, 211, 255), shell: c(255, 226, 166),
  cherry: c(255, 157, 180), star: c(179, 200, 255),
  heart: c(255, 174, 184), cat: c(211, 214, 242), bear: c(244, 197, 145),
  moon: c(255, 236, 170), butterfly: c(190, 214, 255),
};

export const GEL_PALETTE: readonly RGB[] = [
  ...Object.values(OWN_COLORS),
  c(160, 232, 236), // aqua
  c(248, 240, 150), // lemon
  c(255, 170, 150), // coral
  c(200, 232, 170), // sage
  c(205, 170, 250), // grape
  c(255, 210, 170), // apricot
  c(200, 236, 255), // ice
  c(255, 190, 235), // bubblegum
  c(150, 225, 200), // teal mint
];

/** how many recent pads a colour must not repeat within */
export const COLOR_MEMORY = 4;
/** chance a pad shows its own colour (when that colour is not recent) */
export const OWN_COLOR_CHANCE = 0.35;
/** colours closer than this (RGB distance) count as "the same" */
const SAME = 42;

export const colorKey = (x: RGB) => `${x.r},${x.g},${x.b}`;
const dist = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const parse = (k: string): RGB | undefined => {
  const [r, g, b] = k.split(",").map(Number);
  return [r, g, b].every(Number.isFinite) ? { r, g, b } : undefined;
};

/** pads whose colour is their identity keep it: theme pads, variants that are a colour */
export function keepsOwnColor(pad: PadType) {
  if (themeOfPad(pad.id)) return true;
  if (!pad.variantOf) return false;
  const vId = pad.id.split(":")[1];
  return !!(VARIANTS[pad.variantOf] ?? []).find((v) => v.id === vId)?.patch.gelColor;
}

/** a colour for this opening, avoiding the recent ones (keys, newest last) */
export function pickGelColor(pad: PadType, recent: readonly string[], rand: () => number = Math.random): RGB {
  const recentRgb = recent.slice(-COLOR_MEMORY).map(parse).filter((x): x is RGB => !!x);
  const fresh = (x: RGB) => recentRgb.every((r) => dist(r, x) >= SAME);
  const own = OWN_COLORS[pad.variantOf ?? pad.id];
  if (own && fresh(own) && rand() < OWN_COLOR_CHANCE) return own;
  const pool = GEL_PALETTE.filter(fresh);
  const from = pool.length ? pool : GEL_PALETTE;
  return from[Math.floor(rand() * from.length) % from.length];
}

/** the pad as it will be on the table: same pad, this opening's colour */
export function tinted(pad: PadType, recent: readonly string[], rand: () => number = Math.random): PadType {
  if (pad.tinted || keepsOwnColor(pad)) return pad;
  return { ...pad, gelColor: pickGelColor(pad, recent, rand), tinted: true };
}

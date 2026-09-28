import type { Bead } from "../beads/Bead";
import { REF_PAD_R } from "../beads/Bead";
import type { Rng } from "../util/math";
import type { Dome } from "./Bubble";

export interface FiberPoint { x: number; y: number }
/** Reference-pad units, relative to the original slot. Resize never resets extraction. */
export interface Fiber {
  kind?: "chain" | "rainbow" | "charm" | "peel" | "swirl" | "bubble";
  /** Last ratchet already felt; releasing/regrabbing must not replay rewards. */
  felt?: number;
  color: string;
  dark: string;
  light: string;
  radius: number;
  path: FiberPoint[];
  length: number;
  pulled: number;
  tip: FiberPoint;
  released?: FiberPoint[];
  /** 뽁뽁이 막 only: its air domes */
  domes?: Dome[];
  /** bubble only: time the blister opened; the collapsed film fades briefly */
  openedAt?: number;
}

const COLORS = [
  ["#e78fb1", "#ae4f79", "#ffdeeb"],
  ["#66cdb7", "#368f87", "#d5fff1"],
  ["#b399e0", "#7761aa", "#eee4ff"],
] as const;
export const FIBER_SEGMENTS = 64;
export function isChain(f?: Fiber): boolean {
  return f?.kind === "chain" || f?.kind === "rainbow" || f?.kind === "charm";
}
/** the material covers an ordinary bead, which then pops out of its own slot */
export function revealsBead(f?: Fiber) { return f?.kind === "peel" || f?.kind === "swirl" || f?.kind === "bubble"; }
export function chainCount(f: Fiber) { return f.kind === "rainbow" ? 7 : f.kind === "charm" ? 4 : 5; }
/** The pendant stays buried longer; the last pull frees one visibly larger bead. */
export function chainFraction(f: Fiber, i: number) {
  return f.kind === "charm" ? [0, .18, .36, .87][i] : i / chainCount(f);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Resample once, so a revealed fraction also means a fraction of actual yarn length. */
function resample(points: FiberPoint[]) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances[distances.length - 1];
  let j = 1;
  const path = Array.from({ length: FIBER_SEGMENTS + 1 }, (_, i) => {
    const d = i / FIBER_SEGMENTS * length;
    while (j < points.length - 1 && distances[j] < d) j++;
    const t = (d - distances[j - 1]) / Math.max(0.001, distances[j] - distances[j - 1]);
    return { x: lerp(points[j - 1].x, points[j].x, t), y: lerp(points[j - 1].y, points[j].y, t) };
  });
  return { path, length };
}

export function fiberPoint(f: Fiber, fraction = f.pulled / f.length): FiberPoint {
  const u = Math.max(0, Math.min(1, fraction)) * FIBER_SEGMENTS;
  const i = Math.min(FIBER_SEGMENTS - 1, Math.floor(u));
  return { x: lerp(f.path[i].x, f.path[i + 1].x, u - i), y: lerp(f.path[i].y, f.path[i + 1].y, u - i) };
}

/** Replace only ordinary, unstacked surface beads. No extra picks, displaced
 * hidden hosts, new rarity rolls, catalogue entries or persistent save fields.
 * `variant` shifts colour, twist and length so the one yarn of a later pad is
 * not the same pink 118-unit strand every time (pass the completed-pad count). */
export function installFibers(beads: Bead[], padR: number, rng: Rng, count = 3, variant = 0) {
  const scale = padR / REF_PAD_R;
  const candidates = beads.filter(b => !b.fiber && b.layer === 0 && !b.hidden
    && ["common", "big", "odd"].includes(b.type.rarity)
    && !beads.some(other => other.layer === 1 && other.slot === b.slot));
  const chosen: Bead[] = [];
  while (chosen.length < count && candidates.length) {
    // Random first slot, then far apart: three individual discoveries, not a clump.
    const index = chosen.length === 0 ? Math.floor(rng.next() * candidates.length)
      : candidates.reduce((best, b, i) => {
        const distance = (a: Bead) => Math.min(...chosen.map(c => Math.hypot(a.rx - c.rx, a.ry - c.ry)));
        return distance(b) > distance(candidates[best]) ? i : best;
      }, 0);
    const b = candidates.splice(index, 1)[0];
    const ordinal = chosen.length;
    const look = variant + ordinal;
    const radius = Math.min(16, b.radius / scale);
    const angle = rng.range(-Math.PI, Math.PI);
    // A loose, elongated S reads as buried thread rather than a tiny spring.
    // Its pull distance is longer than the folded footprint, so the strand can
    // feel satisfyingly long without taking over neighbouring bead slots.
    const turns = 1.05 + (look % 3) * 0.16;
    const points = Array.from({ length: 161 }, (_, i) => {
      const t = i / 160;
      const x = Math.sin(t * Math.PI * 2 * turns) * radius * 0.46 * (.88 + .12 * Math.cos(t * Math.PI * 2 + look));
      const y = (t - 0.5 + .025 * Math.sin(t * Math.PI * 2)) * radius * 1.55;
      return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
    });
    const { path, length: foldedLength } = resample(points);
    const length = Math.min(165, Math.max(118 + (look % 4) * 12, foldedLength * 3));
    const [color, dark, light] = COLORS[look % COLORS.length];
    const head = path[0], second = path[1];
    const d = Math.hypot(head.x - second.x, head.y - second.y) || 1;
    b.radius = radius * scale;
    b.fiber = { color, dark, light, radius, path, length, pulled: 0,
      tip: { x: head.x + (head.x - second.x) / d * 12, y: head.y + (head.y - second.y) / d * 12 } };
    chosen.push(b);
  }
  return chosen;
}

/** A maximum displacement since each grab, not elapsed time or summed pointer
 * wiggles. Holding still cannot finish it; letting go cannot undo extraction. */
export class FiberPull {
  private start: FiberPoint;
  private tip: FiberPoint;
  private extracted: number;
  private furthest = 0;
  private angle = 0;
  private turn = 0;
  constructor(readonly bead: Bead, x: number, y: number) {
    const f = bead.fiber!;
    this.start = { x, y };
    this.tip = { ...f.tip };
    this.extracted = f.pulled;
    this.angle = Math.atan2(y,x);
  }
  move(x: number, y: number) {
    const f = this.bead.fiber!;
    if(f.kind === "swirl") {
      const angle = Math.atan2(y,x);
      if(Math.hypot(x,y)<f.radius*.25) { this.angle=angle;return false; }
      const delta = Math.atan2(Math.sin(angle-this.angle),Math.cos(angle-this.angle));
      this.angle=angle;this.turn+=delta;
      this.furthest=Math.max(this.furthest,Math.abs(this.turn));
      // 1¼ turns; reversing does not farm progress, either initial direction works.
      f.pulled=Math.min(f.length,this.extracted+this.furthest/(Math.PI*2.5)*f.length);
      const orbit=Math.max(f.radius*.86,Math.min(Math.max(34,f.radius*1.5),Math.hypot(x,y)));
      f.tip={x:Math.cos(angle)*orbit,y:Math.sin(angle)*orbit};
      return f.pulled>=f.length;
    }
    // The end follows the finger directly. The long strand remains visible
    // behind the fingertip, so a pincer or sideways grip offset is unnecessary.
    const dx = x - this.start.x, dy = y - this.start.y;
    const distance = Math.hypot(dx, dy);
    this.furthest = Math.max(this.furthest, distance);
    let extracted = Math.min(f.length, this.extracted + Math.max(0, this.furthest - 5));
    if (isChain(f) && extracted < f.length) {
      // Each bead holds briefly then yields, purely by distance. No speed gate
      // or forced slipback. Absolute stages survive a release and regrab.
      const u = extracted / f.length;
      const stops = Array.from({length:chainCount(f)}, (_, i) => chainFraction(f, i)).concat(1);
      const stage = stops.findIndex((v,i) => i < stops.length-1 && u >= v && u < stops[i+1]);
      const start = stops[stage], width = stops[stage+1] - start, t = (u-start)/width;
      const ease = t < .72 ? t * .6 : .432 + (t - .72) / .28 * .568;
      extracted = Math.max(f.pulled, (start + ease * width) * f.length);
    }
    f.pulled = extracted;
    // A single fast swipe cannot turn a short piece of yarn into an elastic
    // line hundreds of pixels long before the release event is handled.
    const k = Math.min(1, (f.length - this.extracted + 5) / Math.max(1, distance));
    f.tip = { x: this.tip.x + dx * k, y: this.tip.y + dy * k };
    return f.pulled >= f.length;
  }
}

export function relaxFiber(f: Fiber, dt: number) {
  if (!f.pulled || f.released) return;
  if (revealsBead(f)) return; // Lifted flap / rotary grip stays accessible.
  const root = fiberPoint(f);
  const k = 1 - Math.exp(-dt * 9);
  f.tip.x = lerp(f.tip.x, root.x + 12, k);
  f.tip.y = lerp(f.tip.y, root.y - 15, k);
}

/** Free yarn has slack and curls; its buried part disappears by arc length. */
export function exposedFiber(f: Fiber): FiberPoint[] {
  const root = fiberPoint(f);
  const dx = f.tip.x - root.x, dy = f.tip.y - root.y;
  const distance = Math.hypot(dx, dy) || 1;
  const slack = Math.max(0, 4 + f.pulled - distance);
  const curl = Math.min(7, slack * 0.12);
  return Array.from({ length: FIBER_SEGMENTS + 1 }, (_, i) => {
    const t = i / FIBER_SEGMENTS;
    const envelope = Math.sin(t * Math.PI);
    const wave = Math.sin(t * Math.PI * 5) * curl * envelope;
    return { x: root.x + dx * t - dy / distance * wave,
      y: root.y + dy * t + dx / distance * wave + envelope * Math.min(9, slack * 0.08) };
  });
}

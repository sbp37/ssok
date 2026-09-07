export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const len = (x: number, y: number) => Math.hypot(x, y);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/** Gaussian falloff: 1 at r=0, ~0.37 at r=sigma, ~0.02 at r=2sigma. Steep enough that gel deformation stays local. */
export const gauss = (r: number, sigma: number) => {
  const x = r / sigma;
  return Math.exp(-x * x);
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Small deterministic PRNG so pad layouts can later be seeded/shared. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  next: () => number;
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.next = mulberry32(seed);
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  /** ±pct variation multiplier, e.g. jitter(0.08) → 0.92..1.08 */
  jitter(pct: number) {
    return 1 + (this.next() * 2 - 1) * pct;
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}

export const rng = new Rng();

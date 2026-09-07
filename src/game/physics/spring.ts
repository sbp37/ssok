/**
 * Damped harmonic springs. Everything squishy in the game (gel drag lag, bead
 * offset lag, pop recoil, collector jiggle) is one of these, so the whole scene
 * shares one "material" feel and every motion has a bit of mass to it.
 *
 * k        – stiffness. natural period ≈ 2π/√k
 * damping  – c. damping ratio ζ = c / (2√k). ζ≈0.3 → 2~3 visible wobbles.
 */
export class Spring {
  x = 0;
  v = 0;
  target = 0;
  constructor(
    public k: number,
    public damping: number,
  ) {}
  step(dt: number) {
    const a = -this.k * (this.x - this.target) - this.damping * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  impulse(dv: number) {
    this.v += dv;
  }
  set(x: number) {
    this.x = x;
    this.target = x;
    this.v = 0;
  }
  get settled() {
    return Math.abs(this.x - this.target) < 0.01 && Math.abs(this.v) < 0.05;
  }
}

export class Spring2 {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  tx = 0;
  ty = 0;
  constructor(
    public k: number,
    public damping: number,
  ) {}
  step(dt: number) {
    const ax = -this.k * (this.x - this.tx) - this.damping * this.vx;
    const ay = -this.k * (this.y - this.ty) - this.damping * this.vy;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  setTarget(x: number, y: number) {
    this.tx = x;
    this.ty = y;
  }
  impulse(dx: number, dy: number) {
    this.vx += dx;
    this.vy += dy;
  }
  set(x: number, y: number) {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.vx = this.vy = 0;
  }
  get settled() {
    return (
      Math.abs(this.x - this.tx) < 0.01 &&
      Math.abs(this.y - this.ty) < 0.01 &&
      Math.abs(this.vx) < 0.05 &&
      Math.abs(this.vy) < 0.05
    );
  }
}

/** Helper: build a spring from a target period (seconds) and damping ratio. */
export function springParams(periodSec: number, zeta: number) {
  const w = (2 * Math.PI) / periodSec;
  return { k: w * w, damping: 2 * zeta * w };
}

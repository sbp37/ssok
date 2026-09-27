import type { Bead } from "../beads/Bead";
import { getBeadSprite, getShadowSprite } from "../beads/BeadSprites";
import type { Gel } from "../gel/Gel";
import { treasureKind } from "../rewards/treasure";
import { clamp, easeOutCubic } from "../util/math";

/** What the flight/thread drawing needs to know about the pad on screen. */
export interface PadView {
  gel: Gel;
  padCx: number;
  padCy: number;
  /** pad scale (gel.R / REF_PAD_R) */
  s: number;
  dpr: number;
  toCanvas(lx: number, ly: number): { x: number; y: number };
}

/** Visual-only gel bridge: neck -> filament -> two retracting ends. */
export interface Thread {
  hx: number;
  hy: number;
  bead: Bead;
  t: number;
  life: number;
  side: number;
}

const tmp = { x: 0, y: 0 };

/** screen position of a flying bead: kick → hang near the socket → arc to the cup */
export function flyPos(b: Bead, v: PadView) {
  const f = b.fly!;
  const KICK = 0.09;
  if (f.t < KICK) {
    const k = easeOutCubic(f.t / KICK);
    return v.toCanvas(f.px + f.kx * k, f.py + f.ky * k);
  }
  if (f.t < f.hang) {
    // hangs where it landed, drifting back a hair and bobbing once – time to feel the pop
    const u = (f.t - KICK) / (f.hang - KICK);
    const back = -0.14 * Math.sin(u * Math.PI);
    return v.toCanvas(f.px + f.kx * (1 + back), f.py + f.ky * (1 + back) - Math.sin(u * Math.PI) * 3 * v.s);
  }
  const t = clamp((f.t - f.hang) / f.dur, 0, 1);
  const e = t * t * (2 - t) * 0.5 + t * 0.5;
  const mt = 1 - e;
  return {
    x: mt * mt * f.x0 + 2 * mt * e * f.cx + e * e * f.x1,
    y: mt * mt * f.y0 + 2 * mt * e * f.cy + e * e * f.y1,
  };
}

export function drawFlying(ctx: CanvasRenderingContext2D, b: Bead, v: PadView) {
  const f = b.fly!;
  const { x, y } = flyPos(b, v);
  const dpr = v.dpr;
  const flyT = clamp((f.t - f.hang) / f.dur, 0, 1);
  const sh = getShadowSprite(b.radius, dpr);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(sh.canvas, x - sh.w / 2, y - sh.h / 2 + b.radius * (0.6 + flyT * 0.6), sh.w, sh.h);
  ctx.globalAlpha = 1;
  const sp = getBeadSprite(b.type, b.color, b.radius, dpr);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(b.rot + f.spin * Math.max(0, f.t - f.hang));
  const toBox = !!treasureKind(b.type);
  const releaseScale = f.releaseScale ?? 1.12;
  const sc = releaseScale + (1.12 - releaseScale) * easeOutCubic(clamp(f.t / 0.09, 0, 1)) - flyT * (toBox ? 0.55 : 0.3);
  ctx.scale(sc, sc);
  ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
  ctx.restore();
}

/** A tapering translucent bridge, then two short ends that recoil after rupture. */
export function drawThread(ctx: CanvasRenderingContext2D, th: Thread, v: PadView) {
  const b = th.bead;
  if (!b.fly) return;
  const ruptureAt = th.life * (0.115 / 0.19);
  const k = Math.min(1, th.t / ruptureAt);
  const recoil = Math.max(0, (th.t - ruptureAt) / (th.life - ruptureAt));
  const p = flyPos(b, v);
  const bx = p.x - v.padCx;
  const by = (p.y - v.padCy) / v.gel.tilt;
  v.gel.warp(th.hx, th.hy, tmp);
  const hx = tmp.x;
  const hy = tmp.y;
  const dx = bx - hx;
  const dy = by - hy;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const ex = bx - dx / L * b.radius * 0.75;
  const ey = by - dy / L * b.radius * 0.75;
  const sag = th.side * 3 * v.s * k;
  const mx = (hx + ex) * 0.5 + nx * sag;
  const my = (hy + ey) * 0.5 + ny * sag;
  ctx.save();
  ctx.lineCap = 'round';
  if (recoil === 0) {
    // A wide foot remains attached to the socket while the middle narrows.
    const root = b.radius * (0.42 - k * 0.30);
    const tip = b.radius * (0.26 - k * 0.20);
    const waist = Math.max(0.35 * v.s, b.radius * 0.13 * (1 - k));
    ctx.beginPath();
    ctx.moveTo(hx + nx * root, hy + ny * root);
    ctx.bezierCurveTo(hx + dx * 0.16 + nx * waist, hy + dy * 0.16 + ny * waist, mx + nx * waist, my + ny * waist, ex + nx * tip, ey + ny * tip);
    ctx.lineTo(ex - nx * tip, ey - ny * tip);
    ctx.bezierCurveTo(mx - nx * waist, my - ny * waist, hx + dx * 0.16 - nx * waist, hy + dy * 0.16 - ny * waist, hx - nx * root, hy - ny * root);
    ctx.closePath();
    ctx.fillStyle = v.gel.col(0.66, -0.08); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - nx * root * 0.6, hy - ny * root * 0.6);
    ctx.quadraticCurveTo(mx - nx * waist, my - ny * waist, ex, ey);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(0.45, 0.85 * v.s); ctx.stroke();
  } else {
    // Endpoints separate immediately at rupture. No strand follows to the jar.
    const tail = Math.pow(1 - recoil, 2) * 0.43;
    const curl = th.side * Math.sin(recoil * Math.PI) * 5 * v.s;
    ctx.globalAlpha = 1 - recoil;
    ctx.strokeStyle = v.gel.col(0.9, -0.1);
    ctx.lineWidth = (0.8 + recoil * 0.7) * v.s;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.quadraticCurveTo(hx + (mx - hx) * tail + nx * curl, hy + (my - hy) * tail + ny * curl, hx + (ex - hx) * tail, hy + (ey - hy) * tail);
    ctx.moveTo(ex, ey);
    ctx.quadraticCurveTo(ex + (mx - ex) * tail - nx * curl, ey + (my - ey) * tail - ny * curl, ex + (hx - ex) * tail * 0.6, ey + (hy - ey) * tail * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

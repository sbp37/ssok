import { clamp } from "../util/math";

/** The closing beat after a pad is emptied lasts this long (s); NEXT waits for it (App: 1200ms). */
export const FINALE_DURATION = 1.15;
/** Four one-shot glints on the jar, as fractions of its box: [x, y]. */
const JAR_GLINTS: readonly (readonly [number, number])[] = [
  [0.12, 0.22],
  [0.83, 0.12],
  [0.38, -0.03],
  [0.7, 0.52],
];

/** a soft four-pointed glint */
export function drawFinishStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = "#fff9e8";
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.2, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.2, y + r * 0.2, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.2, y + r * 0.2, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x, y - r);
  ctx.fill();
  ctx.restore();
}

/** Six quiet glints on the pad (pad space), staggered once, all gone within FINALE_DURATION. */
export function drawPadFinale(ctx: CanvasRenderingContext2D, t: number, R: number, s: number, reducedMotion: boolean) {
  if (t < 0) return;
  for (let i = 0; i < 6; i++) {
    const p = (t - i * 0.07) / 0.72;
    if (p <= 0 || p >= 1) continue;
    const angle = -Math.PI * 0.8 + i * 2.39996;
    const radius = R * (0.25 + (i % 3) * 0.12);
    const rise = reducedMotion ? 0 : p * 7 * s;
    const size = (4 + i % 3) * s;
    drawFinishStar(ctx, Math.cos(angle) * radius, Math.sin(angle) * radius - rise, size, Math.sin(p * Math.PI) * 0.95);
  }
}

/** The closing beat belongs to what was collected, not only the empty pad.
 * Four one-shot glints on the real jar; no extra particles or reward state. */
export function drawJarFinale(ctx: CanvasRenderingContext2D, t: number, jar: { x: number; y: number; w: number; h: number }, reducedMotion: boolean) {
  if (t < 0) return;
  for (let i = 0; i < 4; i++) {
    const p = (t - 0.08 - i * 0.1) / 0.62;
    if (p <= 0 || p >= 1) continue;
    const x = jar.x + jar.w * JAR_GLINTS[i][0];
    const y = jar.y + jar.h * JAR_GLINTS[i][1] - (reducedMotion ? 0 : p * 5);
    drawFinishStar(ctx, x, y, i % 2 ? 4 : 5.5, Math.sin(p * Math.PI));
  }
}

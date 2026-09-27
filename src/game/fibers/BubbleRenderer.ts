import type { Bead } from "../beads/Bead";
import { getBeadSprite } from "../beads/BeadSprites";
import { BoundedCache } from "../util/BoundedCache";
import type { FiberPoint } from "./Fiber";
import { isBubble } from "./Bubble";

type MapPoint = (p: FiberPoint) => FiberPoint;

/** One pre-rendered air dome per (pixel radius, dpr): the frame only scales it. */
const domes = new BoundedCache<string, { canvas: HTMLCanvasElement; w: number }>(12);
function domeSprite(r: number, dpr: number) {
  const px = Math.max(2, Math.round(r * 2) / 2);
  const key = `${px}|${dpr}`;
  let sp = domes.get(key);
  if (sp) return sp;
  const w = Math.ceil((px * 2 + 4) * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = w;
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  const c = w / dpr / 2;
  // clear plastic bubble: faint body, darker rim, a sharp window highlight
  const body = g.createRadialGradient(c - px * .3, c - px * .35, px * .1, c, c, px);
  body.addColorStop(0, "rgba(255,255,255,.72)");
  body.addColorStop(.55, "rgba(232,247,252,.34)");
  body.addColorStop(1, "rgba(150,196,212,.42)");
  g.fillStyle = body;
  g.beginPath(); g.arc(c, c, px, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(98,150,170,.55)"; g.lineWidth = Math.max(.7, px * .09);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,.95)";
  g.beginPath(); g.ellipse(c - px * .34, c - px * .38, px * .22, px * .13, -.6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(70,110,130,.18)"; g.lineWidth = Math.max(.6, px * .1);
  g.beginPath(); g.arc(c, c, px * .82, .2, Math.PI * .9); g.stroke();
  sp = { canvas, w: w / dpr };
  domes.set(key, sp);
  return sp;
}

/**
 * The film over the bead, its intact / squeezed / popped domes and a short
 * burst ring for the dome that just went. The bead shows more clearly as the
 * air leaves the film.
 */
export function drawBubble(ctx: CanvasRenderingContext2D, b: Bead, map: MapPoint, scale: number, dpr: number, time: number, reducedMotion: boolean) {
  const f = b.fiber!;
  if (!isBubble(f)) return;
  const u = f.pulled / f.length;
  const r = f.radius;
  const centre = map({ x: 0, y: 0 });
  const base = ctx.globalAlpha;
  ctx.save();
  // the bead under the film
  const sp = getBeadSprite(b.type, b.color, Math.round(b.radius * .76 * 2) / 2, dpr);
  ctx.globalAlpha = base * (.55 + .45 * u);
  ctx.save(); ctx.translate(centre.x, centre.y); ctx.rotate(b.rot);
  ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.restore();
  ctx.globalAlpha = base;
  // the film, warped with the gel
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2, q = map({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(236,249,253,${.5 - .2 * u})`;
  ctx.fill();
  ctx.strokeStyle = "rgba(96,148,168,.5)"; ctx.lineWidth = 1.1 * scale; ctx.stroke();
  // domes
  for (const d of f.domes) {
    const p = map(d), dr = d.r * scale;
    if (d.popped) {
      // a flat, creased little crater
      ctx.strokeStyle = "rgba(96,140,158,.34)"; ctx.lineWidth = .8 * scale;
      ctx.beginPath(); ctx.arc(p.x, p.y, dr * .82, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - dr * .45, p.y - dr * .1); ctx.lineTo(p.x + dr * .1, p.y + dr * .18); ctx.lineTo(p.x + dr * .42, p.y - dr * .2); ctx.stroke();
      const age = time - d.at;
      if (!reducedMotion && d.at >= 0 && age < .18) {
        const k = age / .18;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * .75})`; ctx.lineWidth = 1.2 * scale;
        ctx.beginPath(); ctx.arc(p.x, p.y, dr * (1 + k * 1.3), 0, Math.PI * 2); ctx.stroke();
      }
      continue;
    }
    const sq = d.squash;
    const sprite = domeSprite(dr, dpr);
    const sx = 1 + .16 * sq, sy = 1 - .42 * sq;
    ctx.save(); ctx.translate(p.x, p.y + sq * dr * .12); ctx.scale(sx, sy);
    ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.w / 2, sprite.w, sprite.w);
    ctx.restore();
  }
  ctx.restore();
}

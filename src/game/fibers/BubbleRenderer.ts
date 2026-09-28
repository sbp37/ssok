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
  const w = Math.ceil((px * 2.55) * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = w;
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  const c = w / dpr / 2;
  // A clear shipping-cushion dome: mostly transparent, with one coherent
  // upper-left light and a warm lower-right refraction. Avoid the cyan badge
  // outline that made the old five bubbles look like CSS buttons.
  // This contact shadow is baked into the cached sprite, so it adds height
  // without paying for a blur in every frame.
  g.save();
  g.shadowColor = "rgba(92,53,72,.2)";
  g.shadowBlur = px * .24;
  g.fillStyle = "rgba(111,69,88,.1)";
  g.beginPath(); g.ellipse(c + px * .08, c + px * .17, px * .86, px * .76, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  const body = g.createRadialGradient(c - px * .34, c - px * .4, px * .05, c, c, px);
  body.addColorStop(0, "rgba(255,255,255,.9)");
  body.addColorStop(.18, "rgba(255,255,255,.3)");
  body.addColorStop(.68, "rgba(255,244,249,.1)");
  body.addColorStop(1, "rgba(207,158,181,.28)");
  g.fillStyle = body;
  g.beginPath(); g.arc(c, c, px, 0, Math.PI * 2); g.fill();
  const rim = g.createLinearGradient(c - px, c - px, c + px, c + px);
  rim.addColorStop(0, "rgba(255,255,255,.92)");
  rim.addColorStop(.48, "rgba(255,238,246,.62)");
  rim.addColorStop(1, "rgba(139,91,113,.38)");
  g.strokeStyle = rim; g.lineWidth = Math.max(.9, px * .095);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,.96)";
  g.beginPath(); g.ellipse(c - px * .31, c - px * .38, px * .25, px * .11, -.58, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(117,73,96,.16)"; g.lineWidth = Math.max(.7, px * .075);
  g.beginPath(); g.arc(c, c, px * .8, .18, Math.PI * .92); g.stroke();
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
  const opened = f.openedAt !== undefined;
  const openAge = opened ? Math.max(0, time - f.openedAt!) : 0;
  const vanish = Math.min(1, openAge / .22);
  const u = opened ? 1 : f.pulled / f.length;
  const r = f.radius;
  const centre = map({ x: 0, y: 0 });
  const base = ctx.globalAlpha;
  ctx.save();
  // the bead under the film
  const sp = getBeadSprite(b.type, b.color, Math.round(b.radius * .76 * 2) / 2, dpr);
  ctx.globalAlpha = base * (.68 + .32 * u);
  ctx.save(); ctx.translate(centre.x, centre.y); ctx.rotate(b.rot);
  ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.restore();
  ctx.globalAlpha = base;
  // Sealed foot of the air cell. Its light rim is what makes the dome read as
  // packaging around the bead rather than a separate pearl on top.
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2, q = map({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.globalAlpha = base * (1 - vanish);
  ctx.fillStyle = `rgba(255,240,247,${.16 - .08 * u})`;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.82)"; ctx.lineWidth = 1.7 * scale; ctx.stroke();
  ctx.strokeStyle = "rgba(145,91,116,.2)"; ctx.lineWidth = .75 * scale; ctx.stroke();
  // domes
  for (const d of f.domes) {
    const p = map(d), dr = d.r * scale;
    if (d.popped) {
      // The cell implodes into a soft wrinkled ring, then clears so the actual
      // bead is left behind to be pulled normally.
      ctx.globalAlpha = base * (1 - vanish);
      ctx.strokeStyle = "rgba(155,102,126,.3)"; ctx.lineWidth = 1.15 * scale;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + dr * .06, dr * (1 - vanish * .18), dr * (.58 - vanish * .2), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const x0 = p.x + Math.cos(a) * dr * .28, y0 = p.y + Math.sin(a) * dr * .18;
        const x1 = p.x + Math.cos(a) * dr * .72, y1 = p.y + Math.sin(a) * dr * .46;
        ctx.moveTo(x0, y0); ctx.quadraticCurveTo(p.x + Math.cos(a + .35) * dr * .5, p.y + Math.sin(a + .35) * dr * .28, x1, y1);
      }
      ctx.stroke();
      if (!reducedMotion && openAge < .18) {
        const k = openAge / .18;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * .85})`; ctx.lineWidth = 1.35 * scale;
        ctx.beginPath(); ctx.arc(p.x, p.y, dr * (.86 + k * .65), 0, Math.PI * 2); ctx.stroke();
      }
      continue;
    }
    const sq = d.squash;
    const sprite = domeSprite(dr, dpr);
    const sx = 1 + .05 * sq, sy = 1 - .38 * sq;
    ctx.save(); ctx.translate(p.x, p.y + sq * dr * .12); ctx.scale(sx, sy);
    ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.w / 2, sprite.w, sprite.w);
    ctx.restore();
  }
  ctx.globalAlpha = base;
  ctx.restore();
}

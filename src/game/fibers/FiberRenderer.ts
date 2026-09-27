import { exposedFiber, fiberPoint, FIBER_SEGMENTS, type Fiber, type FiberPoint } from "./Fiber";

type MapPoint = (p: FiberPoint) => FiberPoint;
function path(ctx: CanvasRenderingContext2D, points: FiberPoint[]) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
}

function yarn(ctx: CanvasRenderingContext2D, points: FiberPoint[], f: Fiber, width: number) {
  ctx.lineCap = ctx.lineJoin = "round";
  path(ctx, points);ctx.strokeStyle = f.dark;ctx.lineWidth = width + 0.8;ctx.stroke();
  ctx.strokeStyle = f.color;ctx.lineWidth = width;ctx.stroke();
  ctx.save();ctx.translate(-width * 0.16, -width * 0.2);
  path(ctx, points);ctx.strokeStyle = f.light;ctx.lineWidth = width * 0.3;ctx.stroke();ctx.restore();
  // Broad, fixed thread twists; no animated glitter or per-pixel noise.
  ctx.strokeStyle = f.light;ctx.lineWidth = Math.max(0.55, width * 0.2);
  let last = points[0], travelled = 0;
  for (const p of points.slice(1)) {
    const dx = p.x - last.x, dy = p.y - last.y, d = Math.hypot(dx, dy);
    travelled += d;
    if (travelled > width * 2.3 && d > 0.01) {
      travelled = 0;
      ctx.beginPath();ctx.moveTo(p.x + dy / d * width * .3, p.y - dx / d * width * .3);
      ctx.lineTo(p.x - dy / d * width * .3 + dx / d, p.y + dx / d * width * .3 + dy / d);ctx.stroke();
    }
    last = p;
  }
}

/** Pad-local overlay: only a few dozen warped vertices, never a texture upload. */
export function drawFiber(ctx: CanvasRenderingContext2D, f: Fiber, map: MapPoint, scale: number, active: boolean, removed: boolean, gelColor: string) {
  const u = f.pulled / f.length;
  const cut = Math.floor(u * FIBER_SEGMENTS);
  ctx.save();ctx.lineCap = ctx.lineJoin = "round";
  if (cut > 0) {
    // A slim, rounded channel, not the circular socket of the replaced bead.
    const empty = [...f.path.slice(0, cut + 1), fiberPoint(f)].map(map);
    path(ctx, empty);ctx.strokeStyle = "rgba(111,70,112,0.13)";ctx.lineWidth = 3.7 * scale;ctx.stroke();
    ctx.save();ctx.translate(0, .8 * scale);path(ctx, empty);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";ctx.lineWidth = 1.1 * scale;ctx.stroke();ctx.restore();
  }
  if (removed) {ctx.restore();return;}
  const buried = [fiberPoint(f), ...f.path.slice(cut + 1)].map(map);
  // Submerged yarn is coloured transmission, not a glossy wire laid on top.
  // Reserve the crisp contour and thread twists for the exposed part only.
  ctx.save();
  path(ctx, buried);ctx.strokeStyle = f.color;
  ctx.globalAlpha *= .28;ctx.lineWidth = 5.6 * scale;ctx.stroke();
  ctx.globalAlpha *= 2.2;ctx.lineWidth = 2.8 * scale;ctx.stroke();
  ctx.restore();
  const root = map(fiberPoint(f));
  const tip = map(f.tip);
  // A tiny meniscus hugs only the exit; it follows the place being peeled.
  const tension = active ? Math.min(1, Math.hypot(tip.x - root.x, tip.y - root.y) / (35 * scale)) : .12;
  const dx = tip.x - root.x, dy = tip.y - root.y, d = Math.hypot(dx, dy) || 1;
  ctx.beginPath();ctx.ellipse(root.x, root.y + 1 * scale, (3.5 + tension) * scale, 2.8 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(102,63,104,.23)";ctx.fill();
  ctx.beginPath();ctx.moveTo(root.x - 4 * scale, root.y + 2 * scale);
  ctx.quadraticCurveTo(root.x + dx / d * 9 * scale * tension, root.y + dy / d * 9 * scale * tension, root.x + 4 * scale, root.y + 2 * scale);
  ctx.strokeStyle = gelColor;ctx.lineWidth = 4 * scale;ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.78)";ctx.lineWidth = 1 * scale;ctx.stroke();
  const outside = exposedFiber(f).map(map);
  ctx.save();ctx.translate(1.2 * scale, 2.4 * scale);
  path(ctx, outside);ctx.strokeStyle = "rgba(70,45,82,.12)";ctx.lineWidth = 4.7 * scale;ctx.stroke();ctx.restore();
  yarn(ctx, outside, f, 3.3 * scale);
  if (!active) {
    // A rounded, bright end reads as the place to grab, without a button or halo.
    ctx.fillStyle = f.light;ctx.beginPath();ctx.arc(tip.x, tip.y, 1.65 * scale, 0, Math.PI * 2);ctx.fill();
  }
  ctx.restore();
}

/** Existing flight and sleeping collector carry a little yarn curl, not a
 * replacement glass bead. Release curls continuously from the extracted line. */
export function drawFiberCoil(ctx: CanvasRenderingContext2D, f: Fiber, radius: number, curl = 1) {
  const points = Array.from({length:FIBER_SEGMENTS + 1}, (_, i) => {
    const t = i / FIBER_SEGMENTS, a = t * Math.PI * 4.7;
    const r = radius * (.22 + .6 * t);
    const coil = {x:Math.cos(a) * r, y:Math.sin(a) * r * .8};
    const from = f.released?.[i];
    return from && curl < 1 ? {x:from.x * radius / f.radius * (1 - curl) + coil.x * curl,
      y:from.y * radius / f.radius * (1 - curl) + coil.y * curl} : coil;
  });
  ctx.save();yarn(ctx, points, f, Math.max(1.5, radius * .2));ctx.restore();
}

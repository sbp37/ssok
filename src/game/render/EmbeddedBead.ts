import { beadPos, type Bead } from "../beads/Bead";
import { getBeadSprite, getContourMeniscus, getShadowSprite } from "../beads/BeadSprites";
import type { Gel } from "../gel/Gel";
import { clamp } from "../util/math";
import type { PadView } from "./Flight";

/** a deep bead wider than its hole: how much smaller it shows while still in it (1 = as is) */
export function beadFit(b: Bead) {
  return b.slotR !== undefined && b.radius > b.slotR * 0.95 ? (b.slotR * 0.95) / b.radius : 1;
}

/** Shared by the picture and picking: a king bead still in its slot is hole-sized. */
export function embeddedScale(b: Bead, peek = false) {
  const fit = peek ? 1 : beadFit(b);
  return (1 - clamp(b.depth.x, 0, 1) * 0.34) * (fit + (1 - fit) * b.lift) * (1 + b.lift * 0.2);
}

/** One centre for the rigid bead, its gel neck, and the first flight frame (pad space). */
export function embeddedPosition(b: Bead, gel: Gel, s: number, base = false) {
  const p = beadPos(b);
  if (!base) gel.warp(p.x, p.y, p);
  p.y += clamp(b.depth.x, 0, 1) * b.radius * 0.22 - b.lift * 3 * s;
  return p;
}

/**
 * A bead sitting in the gel: contact shadow, the (softened when deep) sprite,
 * a refraction ghost, the meniscus lip and, for rare beads, a faint twinkle.
 * `above` = drawn over the gel while held; `base` = baked into the gel texture.
 */
export function drawEmbeddedBead(ctx: CanvasRenderingContext2D, b: Bead, v: PadView, time: number, above = false, base = false, peek = false) {
  const p = embeddedPosition(b, v.gel, v.s, base);
  // clamp: the depth spring overshoots a hair below 0 and settles there; an alpha above 1
  // is *ignored* by canvas, which left the shadow's 55% in place – every surfaced bead
  // stayed hazy for good
  const depth = clamp(b.depth.x, 0, 1);
  const lift = b.lift;
  // down in the hole it reads smaller and sits lower; rising brings it to full size. A big object
  // under a small hole shows hole-sized until it is pulled: the hole stretches and out comes a big one
  const scale = embeddedScale(b, peek);
  const x = p.x;
  const y = p.y;
  const alpha = Math.min(1, (above ? 1 : 1 - depth * 0.5) * ctx.globalAlpha);
  const dpr = v.dpr;

  // shadow: tighter when embedded, lifts & offsets as the bead comes out
  const sh = getShadowSprite(b.radius, dpr);
  // At rest the socket wall supplies contact shade; a cast shadow underneath
  // the entire bead made it look perched on top. Keep that shadow for lift.
  ctx.globalAlpha = alpha * ((b.type.material === "glass" ? 0.06 : 0.1) + lift * 0.65);
  ctx.drawImage(sh.canvas, x - sh.w * scale / 2 + lift * 4 * v.s, y - sh.h * scale / 2 + b.radius * (0.18 + lift * 0.5), sh.w * scale, sh.h * scale);

  // seen through gel → a softened sprite variant (blur baked in, cached); crisp once it lifts out
  const sp = getBeadSprite(b.type, b.color, b.radius, dpr, base ? depth * 0.7 * v.s : 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(b.rot);
  ctx.scale(scale, scale);
  if (!above && depth > 0.15) {
    // refraction ghost: the gel bends the bead's outline a hair
    ctx.globalAlpha = alpha * depth * 0.12;
    ctx.drawImage(sp.canvas, -sp.w / 2 + 1.2 * v.s, -sp.h / 2 + 1.4 * v.s, sp.w, sp.h);
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
  ctx.restore();
  // meniscus: gel climbing the bead, fades as it's pulled out / when deep
  // one meniscus for every bead: the outline-hugging lip with a directional highlight (light
  // top-left, gel-coloured bottom-right) and a contact shadow – the look the rainbow bead had
  const men = (1 - lift) * (1 - depth) * alpha;
  if (men > 0.02) {
    // A lifted bead changes size every frame. Scale the cached contour with
    // it instead of creating dozens of dilated masks during one pull.
    const ms = getContourMeniscus(b.type, b.color, b.radius, dpr, v.gel.col(1), b.rot);
    ctx.globalAlpha = men;
    ctx.save();ctx.translate(x,y);ctx.rotate(b.rot);ctx.scale(scale,scale);
    ctx.drawImage(ms.canvas, -ms.w / 2, -ms.h / 2, ms.w, ms.h);
    ctx.restore();
  }

  // rare beads twinkle faintly inside the gel
  if (b.type.rarity === "rare" && !above) {
    const tw = 0.35 + 0.35 * Math.sin(time * 3.2 + b.sparkle);
    ctx.globalAlpha = tw * alpha;
    ctx.fillStyle = "#fff";
    const sx = x - b.radius * 0.3;
    const sy = y - b.radius * 0.35;
    const l = b.radius * 0.28;
    ctx.beginPath();
    ctx.moveTo(sx, sy - l);
    ctx.quadraticCurveTo(sx, sy, sx + l, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + l);
    ctx.quadraticCurveTo(sx, sy, sx - l, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - l);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

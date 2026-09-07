import type { BeadType } from "./BeadTypes";

/**
 * Beads are pre-rendered once per (type, color, radius) into small offscreen
 * canvases and drawn with drawImage. Gradients are expensive per-frame on
 * mobile; sprites are essentially free.
 */
export interface Sprite {
  canvas: HTMLCanvasElement;
  /** css px width/height */
  w: number;
  h: number;
}

const cache = new Map<string, Sprite>();
const shadowCache = new Map<string, Sprite>();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number, mix = 0, to: [number, number, number] = [255, 255, 255]) {
  const [r, g, b] = hexToRgb(hex);
  const R = Math.round(r + (to[0] - r) * mix);
  const G = Math.round(g + (to[1] - g) * mix);
  const B = Math.round(b + (to[2] - b) * mix);
  return `rgba(${R},${G},${B},${a})`;
}
const lighten = (hex: string, t: number, a = 1) => rgba(hex, a, t, [255, 255, 255]);
/** darker *same hue* – mixing toward brown made every bead muddy */
const darken = (hex: string, t: number, a = 1) => {
  const [r, g, b] = hexToRgb(hex);
  const k = 1 - t * 0.8;
  // pull slightly toward the hue's saturated version so shadows stay colourful
  const mx = Math.max(r, g, b) || 1;
  const sat = (c: number) => c + (c - mx * 0.5) * 0.15;
  return `rgba(${Math.round(Math.max(0, sat(r) * k))},${Math.round(Math.max(0, sat(g) * k))},${Math.round(Math.max(0, sat(b) * k))},${a})`;
};

export function shapePath(ctx: CanvasRenderingContext2D, type: BeadType, r: number) {
  ctx.beginPath();
  switch (type.shape) {
    case "circle":
    case "smile":
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case "oval": {
      const a = type.aspect ?? 1.7;
      ctx.ellipse(0, 0, r * a * 0.78, r * 0.78, 0, 0, Math.PI * 2);
      break;
    }
    case "disc":
      ctx.ellipse(0, 0, r, r * 0.86, 0, 0, Math.PI * 2);
      break;
    case "star": {
      const spikes = 5;
      const outer = r;
      const inner = r * 0.5;
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const ang = (i * Math.PI) / spikes - Math.PI / 2;
        const x = Math.cos(ang) * rad;
        const y = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "heart": {
      const s = r / 16;
      ctx.moveTo(0, 12 * s);
      ctx.bezierCurveTo(-14 * s, 0, -16 * s, -12 * s, -7 * s, -13 * s);
      ctx.bezierCurveTo(-2 * s, -13 * s, 0, -9 * s, 0, -7 * s);
      ctx.bezierCurveTo(0, -9 * s, 2 * s, -13 * s, 7 * s, -13 * s);
      ctx.bezierCurveTo(16 * s, -12 * s, 14 * s, 0, 0, 12 * s);
      ctx.closePath();
      break;
    }
    case "flower": {
      const petals = 5;
      const pr = r * 0.46;
      for (let i = 0; i < petals; i++) {
        const ang = (i / petals) * Math.PI * 2 - Math.PI / 2;
        const cx = Math.cos(ang) * (r - pr);
        const cy = Math.sin(ang) * (r - pr);
        ctx.moveTo(cx + pr, cy);
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      }
      ctx.moveTo(r * 0.45, 0);
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      break;
    }
    case "eye":
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case "duck": {
      // body + head, one silhouette
      ctx.ellipse(-r * 0.1, r * 0.25, r * 0.85, r * 0.55, 0, 0, Math.PI * 2);
      ctx.moveTo(r * 0.45 + r * 0.42, -r * 0.3);
      ctx.arc(r * 0.45, -r * 0.3, r * 0.42, 0, Math.PI * 2);
      break;
    }
    case "key": {
      // ring head + shaft with two teeth
      ctx.moveTo(-r * 0.15 + r * 0.42, -r * 0.45);
      ctx.arc(-r * 0.15, -r * 0.45, r * 0.42, 0, Math.PI * 2);
      const sw = r * 0.16;
      ctx.moveTo(-r * 0.15 - sw / 2, -r * 0.1);
      ctx.lineTo(-r * 0.15 + sw / 2, -r * 0.1);
      ctx.lineTo(-r * 0.15 + sw / 2, r * 0.95);
      ctx.lineTo(-r * 0.15 - sw / 2, r * 0.95);
      ctx.closePath();
      ctx.rect(-r * 0.15 + sw / 2, r * 0.55, r * 0.32, sw * 0.8);
      ctx.rect(-r * 0.15 + sw / 2, r * 0.82, r * 0.24, sw * 0.8);
      break;
    }
    case "cherry": {
      const cr = r * 0.62;
      ctx.moveTo(-r * 0.4 + cr, r * 0.25);
      ctx.arc(-r * 0.4, r * 0.25, cr, 0, Math.PI * 2);
      ctx.moveTo(r * 0.42 + cr * 0.9, r * 0.32);
      ctx.arc(r * 0.42, r * 0.32, cr * 0.9, 0, Math.PI * 2);
      break;
    }
  }
}

function paintBody(ctx: CanvasRenderingContext2D, type: BeadType, color: string, r: number) {
  const m = type.material;
  // base gradient – light from top-left
  let g: CanvasGradient;
  if (m === "metal") {
    g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#fff4c4");
    g.addColorStop(0.35, color);
    g.addColorStop(0.55, "#fff0b0");
    g.addColorStop(1, "#a8791c");
  } else if (m === "pearl") {
    g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, color);
    g.addColorStop(0.8, rgba(color, 1, 0.25, [246, 200, 220]));
    g.addColorStop(1, rgba(color, 1, 0.35, [190, 200, 230]));
  } else if (m === "glass") {
    g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r);
    g.addColorStop(0, lighten(color, 0.7, 0.7));
    g.addColorStop(0.55, rgba(color, 0.82));
    g.addColorStop(1, darken(color, 0.25, 0.95));
  } else if (m === "shell") {
    g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.7, color);
    g.addColorStop(1, darken(color, 0.15));
  } else {
    g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r * 1.05);
    g.addColorStop(0, lighten(color, 0.55));
    g.addColorStop(0.6, color);
    g.addColorStop(1, darken(color, 0.28));
  }
  ctx.fillStyle = g;
  ctx.fill();

  if (type.id === "rainbow" && "createConicGradient" in ctx) {
    const c = (ctx as CanvasRenderingContext2D & {
      createConicGradient: (a: number, x: number, y: number) => CanvasGradient;
    }).createConicGradient(-0.6, r * 0.1, r * 0.1);
    const hues = ["#ff9ab5", "#ffd28a", "#fff29a", "#a8f0c0", "#9ad8ff", "#c9b0ff", "#ff9ab5"];
    hues.forEach((h, i) => c.addColorStop(i / (hues.length - 1), h));
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (m === "shell") {
    // iridescent bands
    ctx.save();
    ctx.clip();
    const bands = ["#f7b8d0", "#b8e0f7", "#d9f7c8", "#f7e6b8"];
    ctx.lineWidth = r * 0.16;
    ctx.globalAlpha = 0.35;
    bands.forEach((b, i) => {
      ctx.strokeStyle = b;
      ctx.beginPath();
      ctx.ellipse(-r * 0.5 + i * r * 0.32, r * 0.2, r * 1.2, r * 0.5, -0.6, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  // rim
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.strokeStyle = m === "glass" ? lighten(color, 0.4, 0.35) : darken(color, 0.4, 0.3);
  ctx.stroke();
}

function paintFace(ctx: CanvasRenderingContext2D, type: BeadType, r: number) {
  if (type.shape === "eye") {
    // iris + pupil + glint
    const ir = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.52);
    ir.addColorStop(0, "#5b8fd6");
    ir.addColorStop(0.7, "#3b6bb0");
    ir.addColorStop(1, "#2a4f86");
    ctx.fillStyle = ir;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1a22";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(-r * 0.14, -r * 0.16, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (type.shape === "duck") {
    ctx.fillStyle = "#f0a640";
    ctx.beginPath();
    ctx.moveTo(r * 0.82, -r * 0.34);
    ctx.lineTo(r * 1.08, -r * 0.24);
    ctx.lineTo(r * 0.82, -r * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(60,50,40,0.8)";
    ctx.beginPath();
    ctx.arc(r * 0.56, -r * 0.4, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (type.shape !== "smile") return;
  ctx.fillStyle = "rgba(70,50,40,0.85)";
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.15, r * 0.1, 0, Math.PI * 2);
  ctx.arc(r * 0.32, -r * 0.15, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(70,50,40,0.85)";
  ctx.lineWidth = r * 0.11;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, r * 0.05, r * 0.42, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

function paintCherryStem(ctx: CanvasRenderingContext2D, r: number) {
  ctx.strokeStyle = "#5c8a3c";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 0.3);
  ctx.quadraticCurveTo(-r * 0.1, -r * 0.95, r * 0.15, -r * 0.9);
  ctx.moveTo(r * 0.42, -r * 0.25);
  ctx.quadraticCurveTo(r * 0.25, -r * 0.7, r * 0.15, -r * 0.9);
  ctx.stroke();
}

function paintSpecular(ctx: CanvasRenderingContext2D, type: BeadType, r: number) {
  const m = type.material;
  const strong = m === "glass" || m === "metal" || m === "pearl";
  // main highlight
  const hx = -r * 0.36;
  const hy = -r * 0.4;
  const hr = r * (strong ? 0.26 : 0.24);
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
  g.addColorStop(0, `rgba(255,255,255,${strong ? 0.95 : 0.7})`);
  g.addColorStop(0.5, `rgba(255,255,255,${strong ? 0.5 : 0.3})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 1.1, hr * 0.8, -0.7, 0, Math.PI * 2);
  ctx.fill();
  // secondary rim light bottom-right
  const g2 = ctx.createRadialGradient(r * 0.35, r * 0.4, 0, r * 0.35, r * 0.4, r * 0.35);
  g2.addColorStop(0, `rgba(255,255,255,${m === "glass" ? 0.45 : 0.18})`);
  g2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(r * 0.35, r * 0.4, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @param soft  blur in css px baked into the sprite (0 = crisp). Beads seen
 *              through gel use a softened variant; cached per bucket so the
 *              base texture never pays for a filter at render time.
 */
export function getBeadSprite(type: BeadType, color: string, radius: number, dpr: number, soft = 0): Sprite {
  const r = Math.round(radius * 2) / 2;
  const sb = Math.round(soft * 4) / 4;
  const key = `${type.id}|${color}|${r}|${dpr}|${sb}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aspect = type.shape === "oval" ? (type.aspect ?? 1.7) * 0.78 : 1;
  const pad = 6;
  const w = Math.ceil((r * aspect + pad) * 2);
  const h = Math.ceil((r + pad) * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.translate(w / 2, h / 2);
  if (sb > 0 && "filter" in ctx) {
    // draw the crisp sprite once, then re-draw it blurred into this canvas
    const crisp = getBeadSprite(type, color, radius, dpr, 0);
    ctx.filter = `blur(${sb}px)`;
    ctx.drawImage(crisp.canvas, -crisp.w / 2, -crisp.h / 2, crisp.w, crisp.h);
    ctx.filter = "none";
    const sp = { canvas, w, h };
    cache.set(key, sp);
    return sp;
  }

  shapePath(ctx, type, r);
  paintBody(ctx, type, color, r);
  ctx.save();
  shapePath(ctx, type, r);
  ctx.clip();
  paintSpecular(ctx, type, r);
  ctx.restore();
  paintFace(ctx, type, r);
  if (type.shape === "cherry") paintCherryStem(ctx, r);

  const sp = { canvas, w, h };
  cache.set(key, sp);
  return sp;
}

/** Soft contact shadow used under embedded/held/collected beads. */
export function getShadowSprite(radius: number, dpr: number): Sprite {
  const r = Math.round(radius);
  const key = `${r}|${dpr}`;
  const hit = shadowCache.get(key);
  if (hit) return hit;
  const w = Math.ceil(r * 3.2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(w * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const g = ctx.createRadialGradient(w / 2, w / 2, r * 0.4, w / 2, w / 2, r * 1.5);
  g.addColorStop(0, "rgba(70,30,60,0.42)");
  g.addColorStop(0.6, "rgba(70,30,60,0.14)");
  g.addColorStop(1, "rgba(70,30,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  const sp = { canvas, w, h: w };
  shadowCache.set(key, sp);
  return sp;
}

const meniscusCache = new Map<string, Sprite>();
/**
 * Gel around an embedded bead, drawn *over* the bead sprite:
 *  - a clear light ring just outside (the raised meniscus catches light)
 *  - contact darkening outside the rim (ambient occlusion)
 *  - gel creeping over the bead's outer edge, heaviest at the bottom, so the
 *    bead is visibly *sunk into* the gel rather than resting on it.
 */
export function getMeniscusSprite(radius: number, dpr: number, gel: string): Sprite {
  const r = Math.round(radius);
  const key = `${r}|${dpr}|${gel}`;
  const hit = meniscusCache.get(key);
  if (hit) return hit;
  const w = Math.ceil(r * 3.0);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(w * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const c = w / 2;
  const gelA = (a: number) => gel.replace(/[\d.]+\)$/, `${a})`);
  // contact darkening just outside the bead
  const ao = ctx.createRadialGradient(c, c + r * 0.1, r * 0.98, c, c + r * 0.1, r * 1.32);
  ao.addColorStop(0, "rgba(60,50,62,0.26)");
  ao.addColorStop(0.45, "rgba(60,50,62,0.08)");
  ao.addColorStop(1, "rgba(60,50,62,0)");
  ctx.fillStyle = ao;
  ctx.fillRect(0, 0, w, w);
  // light ring: the meniscus lip, brightest top-left
  const ring = ctx.createRadialGradient(c - r * 0.08, c - r * 0.1, r * 1.0, c - r * 0.08, c - r * 0.1, r * 1.34);
  ring.addColorStop(0, "rgba(255,255,255,0)");
  ring.addColorStop(0.3, "rgba(255,255,255,0.5)");
  ring.addColorStop(0.65, "rgba(255,255,255,0.12)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, w, w);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  // gel over the rim, all round
  const lip = ctx.createRadialGradient(c, c, r * 0.7, c, c, r * 1.02);
  lip.addColorStop(0, gelA(0));
  lip.addColorStop(0.62, gelA(0.1));
  lip.addColorStop(1, gelA(0.5));
  ctx.fillStyle = lip;
  ctx.fillRect(0, 0, w, w);
  // heavier gel over the lower part – the bead sits down in the material
  const low = ctx.createRadialGradient(c, c - r * 0.35, r * 0.55, c, c - r * 0.35, r * 1.45);
  low.addColorStop(0, gelA(0));
  low.addColorStop(0.62, gelA(0.06));
  low.addColorStop(1, gelA(0.42));
  ctx.fillStyle = low;
  ctx.fillRect(0, 0, w, w);
  // soft shadow under the top rim (the gel lip shades the bead)
  const cres = ctx.createRadialGradient(c, c + r * 0.55, r * 0.55, c, c + r * 0.3, r * 1.25);
  cres.addColorStop(0, "rgba(60,50,62,0)");
  cres.addColorStop(0.72, "rgba(60,50,62,0.04)");
  cres.addColorStop(1, "rgba(60,50,62,0.22)");
  ctx.fillStyle = cres;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  const sp = { canvas, w, h: w };
  meniscusCache.set(key, sp);
  return sp;
}

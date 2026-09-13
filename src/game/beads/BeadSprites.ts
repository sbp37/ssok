import type { BeadType } from "./BeadTypes";
import { beadAsset, beadAssetTinted } from "./BeadAssets";

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
export function invalidateBeadSprites(){cache.clear();contourCache.clear();}

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
    case "crown": {
      // five-point crown band with a rounded base
      const w = r * 0.95;
      ctx.moveTo(-w, r * 0.55);
      ctx.lineTo(-w, -r * 0.1);
      for (let i = 0; i < 5; i++) {
        const x0 = -w + (i / 5) * 2 * w;
        const x1 = -w + ((i + 0.5) / 5) * 2 * w;
        const x2 = -w + ((i + 1) / 5) * 2 * w;
        ctx.lineTo(x1, -r * (i === 2 ? 0.9 : 0.6));
        ctx.lineTo(x2, -r * 0.1);
        void x0;
      }
      ctx.lineTo(w, r * 0.55);
      ctx.quadraticCurveTo(0, r * 0.75, -w, r * 0.55);
      ctx.closePath();
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

  if ((type.id === "rainbow" || type.id === "holostar") && "createConicGradient" in ctx) {
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
    // Broad nacre colour fields, not elliptical planet-like stripes.
    ctx.save();
    ctx.clip();
    const bands = ["#f7b8d0", "#b8e0f7", "#d9f7c8", "#f7e6b8"];
    bands.forEach((b, i) => {
      const x = -r * 0.55 + (i % 2) * r * 0.95;
      const y = -r * 0.4 + Math.floor(i / 2) * r * 0.85;
      const sheen = ctx.createRadialGradient(x, y, 0, x, y, r * 1.05);
      sheen.addColorStop(0, b + "88");
      sheen.addColorStop(1, b + "00");
      ctx.fillStyle = sheen;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    });
    ctx.restore();
  }

  // rim
  // Canvas save/restore does not restore paths; always outline the bead.
  shapePath(ctx, type, r);
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
  if (type.shape === "crown") {
    // three little jewels
    const cols = ["#ff6fa3", "#6fbfff", "#6fe0ae"];
    cols.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc((i - 1) * r * 0.5, r * 0.2, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc((i - 1) * r * 0.5 - r * 0.04, r * 0.16, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
    });
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
export function getBeadSprite(type: BeadType, color: string, radius: number, dpr: number, soft = 0, art?: "heart"): Sprite {
  const r = Math.round(radius * 2) / 2;
  const sb = Math.round(soft * 4) / 4;
  const key = `${type.id}|${color}|${r}|${dpr}|${sb}|${art ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aspect = type.shape === "oval" ? (type.aspect ?? 1.7) * 0.78 : 1;
  const pad = art === "heart" ? 12 : 6;
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
    const crisp = getBeadSprite(type, color, radius, dpr, 0, art);
    ctx.filter = `blur(${sb}px)`;
    ctx.drawImage(crisp.canvas, -crisp.w / 2, -crisp.h / 2, crisp.w, crisp.h);
    ctx.filter = "none";
    const sp = { canvas, w, h };
    cache.set(key, sp);
    return sp;
  }

  const photo = beadAsset(type, art);
  if (photo) {
    // the cutout fits the bead's long axis, aspect preserved; a tall photo of an
    // oval bead is laid down so the type's long axis stays horizontal
    const nw = photo.naturalWidth;
    const nh = photo.naturalHeight;
    const lie = type.shape === "oval" && nh > nw;
    const longAxis = type.shape === "oval" ? r * aspect * 2 : r * 2;
    const fit = longAxis / Math.max(lie ? nh : nw, lie ? nw : nh);
    const draw = () => {
      ctx.save();
      if (lie) ctx.rotate(-Math.PI / 2);
      ctx.drawImage(photo, (-nw * fit) / 2, (-nh * fit) / 2, nw * fit, nh * fit);
      ctx.restore();
    };
    draw();
    if (beadAssetTinted(type, art)) {
      // recolour: keep the photo's light and shade, take the bead's hue
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      // Keep the photographed body-to-glint contrast. A large white screen
      // lift washed every pastel into milk; only a small exposure correction
      // is needed after recolouring (the source already contains highlights).
      const [tr, tg, tb] = hexToRgb(color);
      const light = (Math.max(tr, tg, tb) + Math.min(tr, tg, tb)) / 510;
      if (light > 0.55) {
        // White resin/pearls still need a pale body, not a grey metal sphere.
        const nearWhite = Math.max(0, (light - 0.85) / 0.15);
        const exposure = Math.min(0.16, (light - 0.55) * 0.4) + nearWhite * 0.14;
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = `rgba(255,255,255,${exposure})`;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      } else if (light < 0.42) {
        // navy, onyx, wine: pull the photo's mid-light body down to the stone's depth, keep its glints
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = `rgba(${tr},${tg},${tb},${Math.min(0.9, (0.42 - light) * 2.4)})`;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      ctx.globalCompositeOperation = "destination-in";
      draw();
      ctx.globalCompositeOperation = "source-over";
    }
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
  const g = ctx.createRadialGradient(w / 2, w / 2, r * 0.5, w / 2, w / 2, r * 1.22);
  g.addColorStop(0, "rgba(70,30,60,0.42)");
  g.addColorStop(0.6, "rgba(70,30,60,0.12)");
  g.addColorStop(1, "rgba(70,30,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  const sp = { canvas, w, h: w };
  shadowCache.set(key, sp);
  return sp;
}

const meniscusCache = new Map<string, Sprite>();
const contourCache = new Map<string, Sprite>();

/** Cached distance-to-silhouette lighting: a rounded cup, not a blurred ring.
 * This height profile is strictly visual; input and spring forces never use it. */
function studioCup(mask: HTMLCanvasElement, dpr: number, r: number, gel: string, angle: number): HTMLCanvasElement {
  const w=mask.width,h=mask.height;
  const alpha=mask.getContext("2d")!.getImageData(0,0,w,h).data;
  const dist=new Float32Array(w*h);
  for(let i=0;i<dist.length;i++)dist[i]=alpha[i*4+3]>127?0:1e5;
  const diagonal=Math.SQRT2;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;dist[i]=Math.min(dist[i],dist[i-1]+1,dist[i-w]+1,dist[i-w-1]+diagonal,dist[i-w+1]+diagonal);
  }
  for(let y=h-2;y>0;y--)for(let x=w-2;x>0;x--){
    const i=y*w+x;dist[i]=Math.min(dist[i],dist[i+1]+1,dist[i+w]+1,dist[i+w-1]+diagonal,dist[i+w+1]+diagonal);
  }
  // Smooth the *visual distance*, not the bead: a hard alpha staircase must
  // not turn into glittering normal changes at mobile resolution.
  const smoothed=new Float32Array(w*h),radius=Math.ceil(dpr*1.6);
  const weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*Math.pow((i-radius)/(dpr*.9),2)));
  const total=weights.reduce((a,b)=>a+b,0);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;for(let k=-radius;k<=radius;k++)sum+=dist[y*w+Math.max(0,Math.min(w-1,x+k))]*weights[k+radius];
    smoothed[y*w+x]=sum/total;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;for(let k=-radius;k<=radius;k++)sum+=smoothed[Math.max(0,Math.min(h-1,y+k))*w+x]*weights[k+radius];
    dist[y*w+x]=sum/total;
  }
  const c=document.createElement("canvas");c.width=w;c.height=h;
  const ctx=c.getContext("2d")!,img=ctx.createImageData(w,h),pixels=img.data;
  const rgb=gel.match(/[\d.]+/g)!.slice(0,3).map(Number);
  const width=Math.min(8,Math.max(3.8,r*.32));
  const lx=-.6*Math.cos(angle)-.8*Math.sin(angle),ly=.6*Math.sin(angle)-.8*Math.cos(angle);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,d=dist[i]/dpr,t=d/width;if(d===0||t>=1||alpha[i*4+3]===255)continue;
    const dx=(dist[i+1]-dist[i-1])*.5,dy=(dist[i+w]-dist[i-w])*.5;
    // Deep inner wall rising to a small soft shoulder, then merging with the pad.
    const crest=Math.exp(-Math.pow((t-.76)/.2,2));
    const slope=1.75*(1-t)-.16*crest*2*(t-.76)/.04;
    const diffuse=(-dx*slope*lx-dy*slope*ly+.85)/Math.hypot(dx*slope,dy*slope,1);
    const shade=(diffuse-.85)*.3-.12*(1-t)*(1-t);
    const facing=dx*lx+dy*ly;
    const shine=.52*crest*(.18+.82*Math.max(0,facing))
      +.25*Math.exp(-Math.pow((t-.32)/.28,2))*Math.max(0,-facing);
    for(let ch=0;ch<3;ch++){
      const body=rgb[ch]+(shade>0?(255-rgb[ch])*shade*2:rgb[ch]*shade);
      pixels[i*4+ch]=Math.max(0,Math.min(255,body+(255-body)*shine));
    }
    pixels[i*4+3]=Math.round((255-alpha[i*4+3])*.88*Math.min(1,(1-t)*5));
  }
  ctx.putImageData(img,0,0);return c;
}

/** Silicone follows the actual charm silhouette, including spaces between
 * petals/cherries. Cached masks retain the original depth/lift animation. */
export function getContourMeniscus(type:BeadType,color:string,radius:number,dpr:number,gel:string,rotation=0,art?:"heart"):Sprite {
  // The contour rotates with the bead, but the light stays at screen top-left.
  const angle=Math.round(rotation*16/Math.PI)*Math.PI/16;
  const r=Math.round(radius*2)/2,key=`${type.id}|${color}|${r}|${dpr}|${gel}|${angle}|${art ?? ""}`;
  const cached=contourCache.get(key);if(cached)return cached;
  const source=getBeadSprite(type,color,r,dpr,0,art);
  const {w,h}=source;
  const make=()=>{const c=document.createElement('canvas');c.width=source.canvas.width;c.height=source.canvas.height;return c;};
  const mask=make(),m=mask.getContext('2d',{willReadFrequently:true})!;
  m.drawImage(source.canvas,0,0);m.globalCompositeOperation='source-in';m.fillStyle='#fff';m.fillRect(0,0,mask.width,mask.height);
  // hard outline: the photo cutouts carry a faint baked-in drop shadow; left in the mask it became
  // a big tilted halo ring around the bead
  {const img=m.getImageData(0,0,mask.width,mask.height),d=img.data;for(let i=3;i<d.length;i+=4)d[i]=Math.max(0,Math.min(255,(d[i]-140)*255/48));m.putImageData(img,0,0);}
  if (art === "heart") {
    const canvas=studioCup(mask,dpr,r,gel,angle);
    const sp={canvas,w,h};contourCache.set(key,sp);return sp;
  }
  const canvas=make(),ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);
  const ux=-.6*Math.cos(angle)-.8*Math.sin(angle),uy=.6*Math.sin(angle)-.8*Math.cos(angle);
  const fx=Math.sin(angle),fy=Math.cos(angle);
  const [gr,gg,gb]=gel.match(/[\d.]+/g)!.map(Number);
  const spread=(size:number,shape=mask)=>{
    const c=make(),g=c.getContext('2d')!;g.scale(dpr,dpr);
    g.drawImage(shape,0,0,w,h);
    for(let i=0;i<16;i++){const a=i*Math.PI/8;g.drawImage(shape,Math.cos(a)*size,Math.sin(a)*size,w,h);}
    return c;
  };
  const outside=(c:HTMLCanvasElement,shape=mask)=>{
    const g=c.getContext('2d')!;
    g.globalCompositeOperation='destination-out';g.drawImage(shape,0,0,w,h);
    g.globalCompositeOperation='source-in';
    return g;
  };
  // A visible inset wall separates the bead from the raised outer lip. The
  // opening is slightly wider, without a projecting bottom ledge. Never paint
  // its shading over the bead.
  const opening=make(),o=opening.getContext('2d')!;o.scale(dpr,dpr);
  const seat=Math.max(1.2,Math.min(2.4,r*.11));
  o.drawImage(spread(seat),0,0,w,h);
  const cavity=make(),v=cavity.getContext('2d')!;v.scale(dpr,dpr);
  v.drawImage(opening,0,0,w,h);outside(cavity);
  const wallShade=v.createLinearGradient(w/2-fx*r,h/2-fy*r,w/2+fx*r,h/2+fy*r);
  wallShade.addColorStop(0,`rgba(${Math.round(gr*.52)},${Math.round(gg*.52)},${Math.round(gb*.57)},.38)`);
  wallShade.addColorStop(.5,`rgba(${Math.round(gr*.62)},${Math.round(gg*.62)},${Math.round(gb*.68)},.24)`);
  wallShade.addColorStop(1,`rgba(${Math.round(gr*.65)},${Math.round(gg*.65)},${Math.round(gb*.72)},.3)`);
  v.fillStyle=wallShade;v.fillRect(0,0,w,h);ctx.drawImage(cavity,0,0,w,h);
  // A narrow silicone shoulder, with light concentrated on its upper-left
  // face. The entire circumference must not become a white sticker border.
  const rim=Math.max(.8,Math.min(1.65,r*.085));
  const shoulder=spread(rim,opening),lip=make(),l=lip.getContext('2d')!;l.scale(dpr,dpr);
  l.drawImage(shoulder,0,0,w,h);outside(lip,opening);
  const span=Math.max(w,h)*.48;
  const reflection=l.createLinearGradient(w/2+ux*span,h/2+uy*span,w/2-ux*span,h/2-uy*span);
  reflection.addColorStop(0,'rgba(255,252,255,.68)');
  reflection.addColorStop(.4,'rgba(255,244,254,.25)');
  reflection.addColorStop(.62,'rgba(255,250,255,.06)');
  reflection.addColorStop(1,'rgba(255,250,255,0)');
  l.fillStyle=reflection;l.fillRect(0,0,w,h);ctx.drawImage(lip,0,0,w,h);
  // Only the narrow seam touching the bead is shaded. No blurred AO halo.
  const seam=spread(Math.max(.45,r*.032)),s=outside(seam);
  s.fillStyle='rgba(101,68,107,.19)';s.fillRect(0,0,w,h);ctx.drawImage(seam,0,0,w,h);
  // The raised outer crest catches a separate thin upper-left reflection.
  const crest=make(),c0=crest.getContext('2d')!;c0.scale(dpr,dpr);
  c0.drawImage(shoulder,0,0,w,h);c0.globalCompositeOperation='destination-out';
  const shine=Math.max(.65,r*.04);
  c0.drawImage(shoulder,-ux*shine,-uy*shine,w,h);outside(crest,opening);
  c0.fillStyle='rgba(255,255,255,.68)';c0.fillRect(0,0,w,h);ctx.drawImage(crest,0,0,w,h);
  // The rear wall casts a SHORT shadow inside the opening, onto the bead.
  // Subtracted silhouette masks keep this out of the exposed central body.
  const inset=(dx:number,dy:number)=>{
    const c=make(),g=c.getContext('2d')!;g.scale(dpr,dpr);
    g.drawImage(mask,0,0,w,h);g.globalCompositeOperation='destination-out';
    g.drawImage(mask,dx,dy,w,h);g.globalCompositeOperation='source-in';
    return {canvas:c,ctx:g};
  };
  const wallDepth=Math.max(.8,Math.min(1.6,r*.085));
  const wall=inset(-ux*wallDepth,-uy*wallDepth);
  wall.ctx.fillStyle='rgba(77,53,88,.28)';wall.ctx.fillRect(0,0,w,h);
  ctx.drawImage(wall.canvas,0,0,w,h);

  // No coloured front cap: it read as a pink pedestal under every bead.
  const sp={canvas,w,h};contourCache.set(key,sp);return sp;
}
/**
 * Gel around an embedded bead, drawn *over* the bead sprite:
 *  - a clear light ring just outside (the raised meniscus catches light)
 *  - contact darkening outside the rim (ambient occlusion)
 *  - gel veiling only the part BELOW the waterline, denser toward the bottom,
 *    so the bead reads as half-sunk: its top keeps its own colour.
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
  // contact darkening just outside the bead. A radial gradient paints its
  // stop-0 colour over the whole inner disc, so this MUST be clipped to the
  // outside of the bead – unclipped it veiled every bead 20% grey.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, w);
  ctx.arc(c, c, r * 0.97, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  // tight: a dark contact line right at the bead, gone within ~0.15r (a wide soft ring read as haze)
  const ao = ctx.createRadialGradient(c, c + r * 0.06, r * 0.97, c, c + r * 0.06, r * 1.2);
  ao.addColorStop(0, "rgba(60,50,62,0.42)");
  ao.addColorStop(0.4, "rgba(60,50,62,0.12)");
  ao.addColorStop(1, "rgba(60,50,62,0)");
  ctx.fillStyle = ao;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  // light ring: the meniscus lip, brightest top-left
  // the raised gel lip: a definite thin light ring hugging the bead – this is what makes it read
  // as sitting *in* a hole rather than lying on the surface
  const ring = ctx.createRadialGradient(c - r * 0.05, c - r * 0.07, r * 1.0, c - r * 0.05, c - r * 0.07, r * 1.17);
  ring.addColorStop(0, "rgba(255,255,255,0.1)");
  ring.addColorStop(0.3, "rgba(255,255,255,0.62)");
  ring.addColorStop(0.65, "rgba(255,255,255,0.14)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, w, w);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  // The bead sits half out of the gel: everything above the waterline keeps the
  // bead's own colour. Seen from slightly above, the waterline on a sphere is
  // the lower arc of an ellipse; below it the gel veils the bead, denser toward
  // the bottom, and the edge is soft – no hard stripe.
  const water = c + r * 0.06;
  const ry = r * 0.34;
  const belowArc = () => {
    ctx.beginPath();
    ctx.moveTo(c - r, water);
    ctx.ellipse(c, water, r, ry, 0, Math.PI, 0, true); // lower half, left → right
    ctx.lineTo(c + r, w);
    ctx.lineTo(c - r, w);
    ctx.closePath();
  };
  ctx.save();
  belowArc();
  ctx.clip();
  const veil = ctx.createLinearGradient(0, water, 0, c + r);
  veil.addColorStop(0, gelA(0.14));
  veil.addColorStop(0.45, gelA(0.3));
  veil.addColorStop(1, gelA(0.55));
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  // soften the arc itself: a narrow gradient band straddling the waterline
  ctx.save();
  belowArc();
  ctx.clip();
  const soft = ctx.createLinearGradient(0, water - ry * 0.4, 0, water + ry * 1.2);
  soft.addColorStop(0, gelA(0.12));
  soft.addColorStop(1, gelA(0));
  ctx.fillStyle = soft;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
  // faint glint where the surface meets the bead
  ctx.beginPath();
  ctx.ellipse(c, water, r * 0.96, ry * 0.96, 0, Math.PI * 0.08, Math.PI * 0.92);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.stroke();
  ctx.restore();
  const sp = { canvas, w, h: w };
  meniscusCache.set(key, sp);
  return sp;
}

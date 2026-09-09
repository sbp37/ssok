import { Spring, Spring2, springParams } from "../physics/spring";
import { gauss } from "../util/math";
import { PADS, type PadType } from "../pads/PadTypes";
import { originalMaterial, siliconeColor } from './Material';

/**
 * The gel pad.
 *
 *   static base texture  →  per-frame affine mesh warp  →  dynamic shading
 *
 * The base texture (side wall, translucent body, edge thickness, grain, the
 * embedded beads, tint, Fresnel rim) is rendered once and re-rendered only
 * when a bead is grabbed / released / popped. Every frame it is drawn as a
 * grid of small cells, each mapped through the displacement field `warp()`
 * with its own affine transform, so the *texture itself* stretches under a
 * finger, bulges around a pop and jiggles on release – silhouette included.
 * Dimples, dents, the neck of a pulled bead and the sliding highlights are
 * cheap overlays drawn afterwards in pad-local space.
 *
 * Pad-local coordinates: (0,0) at the pad centre, y down, unsquashed
 * (the caller applies the camera tilt).
 */

export interface Finger {
  id: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
  press: Spring;
  drag: Spring2;
  down: boolean;
}

export interface Dent {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
}

export interface PullInfluence {
  /** socket position (pad-local) */
  hx: number;
  hy: number;
  /** how far the gel around the socket is pulled toward the finger */
  sx: number;
  sy: number;
  r: number;
}

/** radial shock left by a pop – the gel around the hole bulges and rings down */
interface Shock {
  x: number;
  y: number;
  r: number;
  s: Spring;
}

const pressP = springParams(0.14, 0.5);
const dragP = springParams(0.2, 0.3);
const wobbleP = springParams(0.19, 0.28);
const shockP = springParams(0.16, 0.26);

const socketCache = new Map<string, HTMLCanvasElement>();
/** empty socket: a shallow cup – dark centre, light lip at the bottom */
function getSocketSprite(r: number, dpr: number, gel: string) {
  const key = `${Math.round(r)}|${dpr}|${gel}|${originalMaterial}`;
  const hit = socketCache.get(key);
  if (hit) return hit;
  const rr = Math.round(r);
  const size = Math.ceil(rr * 2.8);
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(size * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const cx = size / 2;
  // Restore Claude's volumetric socket, not the bright outlined replacement.
  const grad = g.createRadialGradient(cx, cx + rr * 0.12, rr * 0.15, cx, cx, rr * 1.18);
  grad.addColorStop(0, "rgba(70,60,70,0.22)");
  grad.addColorStop(0.6, "rgba(90,40,80,0.1)");
  grad.addColorStop(0.86, "rgba(90,40,80,0.02)");
  grad.addColorStop(0.92, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  socketCache.set(key, c);
  return c;
}

export class Gel {
  R = 150;
  /** vertical squash for the "looking down at ~12°" feel */
  tilt = 0.94;
  readonly N = 96;
  restR: number[] = [];
  /** inner hole radius multipliers (empty = no hole) */
  holeR: number[] = [];
  pad: PadType = PADS[0];
  /** physical multipliers from the PadType */
  soft = 1;
  stretchK = 1;
  wobbleK = 1;
  coupling = 0;
  thickK = 1;
  transparency = 1;
  centerThick = false;
  private shapeSeed = Math.random() * 1000;
  fingers = new Map<number, Finger>();
  wobble = new Spring2(wobbleP.k, wobbleP.damping);
  shocks: Shock[] = [];
  dents: Dent[] = [];
  sockets: { x: number; y: number; r: number }[] = [];
  pulls: PullInfluence[] = [];
  fade = 1;
  time = 0;
  color = { r: 238, g: 200, b: 226 };

  // base texture
  private tex: HTMLCanvasElement | null = null;
  private texCtx: CanvasRenderingContext2D | null = null;
  private texDpr = 1;
  private texE = 0;
  private dirty = true;
  private grain: HTMLCanvasElement | null = null;
  private grainR = -1;
  private formLight: HTMLCanvasElement | null = null;
  private formLightR = -1;
  // mesh
  readonly gridN = 22;
  private vx = new Float32Array((this.gridN + 1) * (this.gridN + 1));
  private vy = new Float32Array((this.gridN + 1) * (this.gridN + 1));
  /** interleaved device-px vertex positions for the GL path */
  readonly meshPos = new Float32Array((this.gridN + 1) * (this.gridN + 1) * 2);
  private tmp = { x: 0, y: 0 };
  /** version counter – bumps whenever the base texture is re-rendered */
  baseVersion = 0;
  get baseTexture() {
    return this.tex;
  }
  /** half-extent of the base texture in pad-local px */
  get extent() {
    return this.texE;
  }

  constructor(seed = Math.random() * 1000) {
    this.shapeSeed = seed;
    this.setShape(PADS[0]);
  }

  /** Build the outline (and hole) from a PadType and take over its physical parameters. */
  setShape(pad: PadType) {
    this.pad = pad;
    const seed = this.shapeSeed;
    const p1 = seed,
      p2 = seed * 1.7,
      p3 = seed * 0.3;
    const noise = pad.noise ?? 0.02;
    this.restR = [];
    this.holeR = [];
    for (let i = 0; i < this.N; i++) {
      const th = (i / this.N) * Math.PI * 2;
      const n = noise * (Math.sin(th * 2 + p2) + 0.6 * Math.sin(th * 3 + p3) + 0.3 * Math.sin(th * 11 + p1));
      this.restR.push(pad.outline(th) + n);
      if (pad.hole) this.holeR.push(pad.hole(th) + n * 0.3);
    }
    this.color = siliconeColor(pad.gelColor,pad.id);
    this.soft = pad.softness;
    this.stretchK = pad.stretch;
    this.wobbleK = pad.wobble;
    this.coupling = pad.coupling ?? 0;
    this.thickK = pad.thickness;
    this.transparency = pad.transparency;
    this.centerThick = !!pad.centerThick;
    this.shadowR = -1;
    this.grainR = -1;
    this.formLightR = -1;
    this.dirty = true;
  }

  get hasHole() {
    return this.holeR.length > 0;
  }

  private readonly lightNodes = new Float32Array(6*4);
  /** Visual-only height sources in rest/R space. XY warp is not a normal map.
   * Reuses the existing springs and pull vectors; no input or physics writes. */
  materialLights():Float32Array|null {
    if(originalMaterial || (!this.fingers.size && !this.pulls.length && !this.shocks.length))return null;
    this.lightNodes.fill(0);
    let i=0;
    const node=(x:number,y:number,r:number,h:number)=>{
      if(i>=6)return;
      this.lightNodes.set([x/this.R,y/this.R,r/this.R,h/this.R],i++*4);
    };
    // Raised silicone around held beads, followed by local post-pop settling.
    for(const p of this.pulls) {
      const L=Math.hypot(p.sx,p.sy);
      node(p.hx+p.sx*.35,p.hy+p.sy*.35,p.r*2.6,Math.min(p.r*.7,L*.42));
    }
    for(const sh of this.shocks)node(sh.x,sh.y,sh.r*1.8,sh.s.x*.6);
    for(const f of this.fingers.values())node(f.x,f.y,this.R*.20,-this.R*.014*f.press.x);
    return this.lightNodes;
  }

  get thick() {
    return this.R * 0.085 * this.thickK;
  }

  /** rest boundary radius multiplier at angle θ */
  boundary(th: number) {
    const u = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (u / (Math.PI * 2)) * this.N;
    const i = Math.floor(f) % this.N;
    const j = (i + 1) % this.N;
    const k = f - Math.floor(f);
    return this.restR[i] * (1 - k) + this.restR[j] * k;
  }

  /** hole radius multiplier at angle θ (0 when the pad has no hole) */
  holeAt(th: number) {
    if (!this.holeR.length) return 0;
    const u = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (u / (Math.PI * 2)) * this.N;
    const i = Math.floor(f) % this.N;
    const j = (i + 1) % this.N;
    const k = f - Math.floor(f);
    return this.holeR[i] * (1 - k) + this.holeR[j] * k;
  }

  inside(x: number, y: number) {
    const th = Math.atan2(y, x);
    const d = Math.hypot(x, y);
    return d < this.R * this.boundary(th) && d > this.R * this.holeAt(th);
  }

  markDirty() {
    this.dirty = true;
  }
  get needsBase() {
    return this.dirty;
  }

  // ─── fingers ──────────────────────────────────────────────────
  fingerDown(id: number, x: number, y: number) {
    const f: Finger = {
      id,
      x,
      y,
      ax: x,
      ay: y,
      press: new Spring(pressP.k, pressP.damping),
      drag: new Spring2(dragP.k, dragP.damping),
      down: true,
    };
    f.press.target = 1;
    this.fingers.set(id, f);
    return f;
  }
  fingerMove(id: number, x: number, y: number) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x;
    f.y = y;
  }
  fingerUp(id: number) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.down = false;
    f.press.target = 0;
    f.drag.setTarget(0, 0);
  }
  reanchor(id: number) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.ax = f.x;
    f.ay = f.y;
  }

  recoil(dx: number, dy: number) {
    this.wobble.impulse(dx, dy);
  }

  /** pop shock: gel around (x,y) bulges outward by ~amp px then rings down */
  shock(x: number, y: number, r: number, amp: number) {
    const s = new Spring(shockP.k, shockP.damping);
    s.impulse(amp * 22);
    this.shocks.push({ x, y, r, s });
  }

  addDent(x: number, y: number, r: number, life = 1.7) {
    this.dents.push({ x, y, r, t: 0, life });
  }

  // ─── simulation ───────────────────────────────────────────────
  step(dt: number) {
    this.time += dt;
    for (const [id, f] of this.fingers) {
      if (f.down) {
        // anchor drifts toward the finger: gel can only stretch so far before it "lets go"
        const k = 1 - Math.pow(0.001, dt);
        f.ax += (f.x - f.ax) * k * 0.55;
        f.ay += (f.y - f.ay) * k * 0.55;
        const dx = f.x - f.ax;
        const dy = f.y - f.ay;
        const L = Math.hypot(dx, dy);
        const max = this.R * 0.28;
        const s = L > max ? max / L : 1;
        f.drag.setTarget(dx * s, dy * s);
      }
      f.press.step(dt);
      f.drag.step(dt);
      if (!f.down && f.press.x < 0.005 && f.drag.settled) this.fingers.delete(id);
    }
    this.wobble.step(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i].s;
      s.step(dt);
      if (s.settled) this.shocks.splice(i, 1);
    }
    for (let i = this.dents.length - 1; i >= 0; i--) {
      const d = this.dents[i];
      d.t += dt;
      if (d.t > d.life) this.dents.splice(i, 1);
    }
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt * 1.6);
  }

  /** the displacement field: where a rest point (x,y) appears right now */
  warp(x: number, y: number, out = { x: 0, y: 0 }) {
    let ox = x;
    let oy = y;
    const R = this.R;
    const s = R / 170;
    for (const f of this.fingers.values()) {
      const dx = x - f.x;
      const dy = y - f.y;
      const d = Math.hypot(dx, dy) + 1e-4;
      // dimple: contact pushes material outward in a ring, the centre sinks (not shown in-plane)
      const push = f.press.x * 7 * s * this.soft * gauss(d, 36 * s) * (1 - gauss(d, 10 * s));
      ox += (dx / d) * push;
      oy += (dy / d) * push;
      // drag: the surface sticks to the finger; steep falloff, ~150px reach (further on stretchy pads)
      const g = gauss(d, 72 * s * this.stretchK) * 0.66 * this.soft;
      ox += f.drag.x * g;
      oy += f.drag.y * g;
    }
    for (const p of this.pulls) {
      const dx = x - p.hx;
      const dy = y - p.hy;
      const d = Math.hypot(dx, dy);
      // gel holding the bead is dragged toward the finger – a tent around the socket
      const g = gauss(d, p.r * 3.8 * this.stretchK) * 0.62 * this.soft;
      ox += p.sx * g;
      oy += p.sy * g;
      // the pull is felt faintly across the whole pad (cherry: the other lobe sways a hair)
      if (this.coupling > 0) {
        const far = 1 - gauss(d, p.r * 5);
        ox += p.sx * 0.08 * this.coupling * far;
        oy += p.sy * 0.08 * this.coupling * far;
      }
    }
    for (const sh of this.shocks) {
      const dx = x - sh.x;
      const dy = y - sh.y;
      const d = Math.hypot(dx, dy) + 1e-4;
      const g = sh.s.x * gauss(d, sh.r * 2.6) * (1 - gauss(d, sh.r * 0.5));
      ox += (dx / d) * g;
      oy += (dy / d) * g;
    }
    const rr = Math.hypot(x, y) / R;
    ox += this.wobble.x * (0.2 + rr * 0.7) * this.wobbleK;
    oy += this.wobble.y * (0.2 + rr * 0.7) * this.wobbleK;
    out.x = ox;
    out.y = oy;
    return out;
  }

  // ─── colour helpers ───────────────────────────────────────────
  /** gel colour at alpha a; dark>0 darkens, dark<0 lightens toward white */
  col(a: number, dark = 0) {
    const { r, g, b } = this.color;
    if (dark < 0) {
      const m = -dark;
      return `rgba(${Math.round(r + (255 - r) * m)},${Math.round(g + (255 - g) * m)},${Math.round(b + (255 - b) * m)},${a})`;
    }
    const k = 1 - dark;
    return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`;
  }

  // ─── paths ────────────────────────────────────────────────────
  /** rest outline (no warp) – used for the base texture */
  private restPath(ctx: CanvasRenderingContext2D, dy = 0, scale = 1, withHole = true) {
    ctx.beginPath();
    const n = this.N;
    const loop = (arr: number[], sc: number) => {
      const pt = (i: number) => {
        const th = (i / n) * Math.PI * 2;
        const r = this.R * arr[i % n] * sc;
        return { x: Math.cos(th) * r, y: Math.sin(th) * r + dy };
      };
      let p0 = pt(n - 1);
      let p1 = pt(0);
      ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      for (let i = 0; i < n; i++) {
        p0 = pt(i);
        p1 = pt(i + 1);
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      }
      ctx.closePath();
    };
    loop(this.restR, scale);
    // the hole shrinks when the outline is inset (scale<1) → grow it by the same amount
    if (withHole && this.holeR.length) loop(this.holeR, 2 - scale);
  }

  /** live outline (warped) – used to clip dynamic overlays */
  outlinePath(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    const n = this.N;
    const tmp = this.tmp;
    const loop = (arr: number[]) => {
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const r = this.R * arr[i];
        this.warp(Math.cos(th) * r, Math.sin(th) * r, tmp);
        pts.push(tmp.x, tmp.y);
      }
      let ax = pts[(n - 1) * 2],
        ay = pts[(n - 1) * 2 + 1];
      ctx.moveTo((ax + pts[0]) / 2, (ay + pts[1]) / 2);
      for (let i = 0; i < n; i++) {
        ax = pts[i * 2];
        ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const by = pts[((i + 1) % n) * 2 + 1];
        ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
      }
      ctx.closePath();
    };
    loop(this.restR);
    if (this.holeR.length) loop(this.holeR);
  }

  // ─── base texture ─────────────────────────────────────────────
  /** Static visual height, derived from the actual lobed boundary. Cached per
   * shape/resize; never changes the physics mesh or adds painted-in holes. */
  private ensureFormLight() {
    if (this.formLight && this.formLightR === this.R) return this.formLight;
    const R = this.R, E = R * 1.3;
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    const g = c.getContext('2d')!, data = g.createImageData(320, 320);
    const sampleRadius = (a: number, arr: number[]) => {
      const k = ((a / (Math.PI * 2) + 1) % 1) * arr.length;
      const i = Math.floor(k), t = k - i;
      const n = arr.length, a0 = arr[(i + n - 1) % n], a1 = arr[i], a2 = arr[(i + 1) % n], a3 = arr[(i + 2) % n];
      return .5 * ((2 * a1) + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t * t + (-a0 + 3 * a1 - 3 * a2 + a3) * t * t * t) * R;
    };
    const height = (x: number, y: number) => {
      const a = Math.atan2(y, x), r = Math.hypot(x, y);
      const outer = sampleRadius(a, this.restR);
      let d = outer - r;
      if (this.holeR.length) d = Math.min(d, r - sampleRadius(a, this.holeR));
      if (d <= 0) return 0;
      // A rounded shoulder at each petal, with a gently domed centre.
      return this.thick * (0.85 * (1 - Math.exp(-d / (R * 0.095))) + 0.36 * Math.exp(-r * r / (R * R * .7)));
    };
    for (let j = 0; j < 320; j++) for (let i = 0; i < 320; i++) {
      const x = ((i + .5) / 320 * 2 - 1) * E, y = ((j + .5) / 320 * 2 - 1) * E;
      if (height(x, y) <= 0) continue;
      const dx = (height(x + 1, y) - height(x - 1, y)) * .5;
      const dy = (height(x, y + 1) - height(x, y - 1)) * .5;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const response = (.46 * dx + .56 * dy + .69) * inv - .69;
      const k = (j * 320 + i) * 4;
      const light = response > 0;
      data.data[k] = light ? 255 : Math.round(this.color.r * .67);
      data.data[k + 1] = light ? 250 : Math.round(this.color.g * .63);
      data.data[k + 2] = light ? 254 : Math.round(this.color.b * .71);
      data.data[k + 3] = Math.round(Math.min(light ? .3 : .2, Math.abs(response) * .85) * 255);
    }
    g.putImageData(data, 0, 0);
    this.formLight = c; this.formLightR = R;
    return c;
  }

  private ensureGrain() {
    const R = this.R;
    if (this.grainR === R && this.grain) return this.grain;
    this.grainR = R;
    const size = Math.ceil(R * 2.3);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    g.translate(size / 2, size / 2);
    // large soft unevenness
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.7;
      const x = Math.cos(a) * R * (0.3 + (i % 3) * 0.12);
      const y = Math.sin(a) * R * (0.3 + ((i + 1) % 3) * 0.12);
      const gg = g.createRadialGradient(x, y, 0, x, y, R * 0.36);
      gg.addColorStop(0, i % 2 ? "rgba(255,255,255,0.07)" : "rgba(50,40,50,0.03)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gg;
      g.fillRect(-size / 2, -size / 2, size, size);
    }
    // fine satin noise
    const img = g.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 20;
      const empty = d[i + 3] === 0;
      const base = empty ? 128 : 0;
      d[i] = Math.min(255, Math.max(0, d[i] + base + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + base + n));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + base + n));
      d[i + 3] = Math.min(255, d[i + 3] + 6 + Math.abs(n) * 0.4);
    }
    g.putImageData(img, 0, 0);
    this.grain = c;
    return c;
  }

  /**
   * Re-render the base texture. `inner` draws the embedded beads (and their
   * sockets) in pad-local space while clipped to the surface.
   */
  renderBase(inner: (ctx: CanvasRenderingContext2D) => void) {
    const R = this.R;
    const E = (this.texE = R * 1.3);
    const dpr = (this.texDpr = Math.min(2, window.devicePixelRatio || 1));
    const size = Math.ceil(E * 2 * dpr);
    if (!this.tex || this.tex.width !== size) {
      this.tex = document.createElement("canvas");
      this.tex.width = this.tex.height = size;
      this.texCtx = this.tex.getContext("2d")!;
    }
    const ctx = this.texCtx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(dpr, 0, 0, dpr, E * dpr, E * dpr);
    const t = this.thick;

    // ── side wall: the outline swept down by the slab thickness
    const steps = 7;
    for (let i = steps; i >= 1; i--) {
      const k = i / steps;
      this.restPath(ctx, t * k);
      ctx.fillStyle = this.col(0.9, originalMaterial ? 0.1 + 0.22 * k : 0.055 + 0.16 * k);
      ctx.fill("evenodd");
    }
    // light leaking out of the bottom edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(-E, R * 0.2, E * 2, E);
    ctx.clip();
    this.restPath(ctx, t);
    ctx.strokeStyle = "rgba(255,236,248,0.6)";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
    // the wall must only exist *below* the translucent top surface – cut the top out
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    this.restPath(ctx);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
    ctx.restore();
    // a thin darker seam where the wall meets the surface (visible through the top)
    ctx.save();
    this.restPath(ctx);
    ctx.clip("evenodd");
    this.restPath(ctx, t * 0.35);
    ctx.fillStyle = this.col(originalMaterial ? 0.25 : 0.17, 0.25);
    ctx.fill("evenodd");
    ctx.restore();

    // ── top surface
    this.restPath(ctx);
    const tr = 1 / this.transparency;
    const body = ctx.createRadialGradient(-R * 0.1, -R * 0.15, R * 0.05, 0, 0, R * 1.08);
    if (this.centerThick) {
      // this pad is thickest in the middle: denser colour at the centre, thinning toward the tips
      body.addColorStop(0, this.col((originalMaterial ? 0.42 : 0.36) * tr, 0.06));
      body.addColorStop(0.4, this.col((originalMaterial ? 0.3 : 0.25) * tr, -0.02));
      body.addColorStop(0.8, this.col(0.22 * tr, -0.08));
      body.addColorStop(1, this.col(0.5 * tr, 0.1));
    } else {
      // centre is thin → pale and see-through; rim is thick → deeper colour
      body.addColorStop(0, this.col((originalMaterial ? 0.12 : 0.10) * tr, -0.25));
      body.addColorStop(0.45, this.col((originalMaterial ? 0.2 : 0.17) * tr, -0.08));
      body.addColorStop(0.8, this.col((originalMaterial ? 0.38 : 0.33) * tr, 0.03));
      body.addColorStop(1, this.col(0.62 * tr, 0.12));
    }
    ctx.fillStyle = body;
    ctx.fill("evenodd");
    ctx.save();
    ctx.clip("evenodd");
    // thickness band hugging the actual (lobed) outline: several inset strokes
    for (let i = 0; i < 4; i++) {
      this.restPath(ctx, 0, 1 - i * 0.028);
      ctx.lineWidth = R * 0.075;
      ctx.strokeStyle = this.col((0.1 - i * 0.02) * (originalMaterial ? 1 : 0.75), 0.3);
      ctx.stroke();
    }
    if (this.hasHole) {
      // the inner rim reads as a wall too: darker just inside the hole's edge
      const h = this.holeR.reduce((a, b) => a + b, 0) / this.holeR.length;
      const rim = ctx.createRadialGradient(0, 0, R * h * 0.95, 0, 0, R * (h + 0.16));
      rim.addColorStop(0, this.col(0.4, 0.34));
      rim.addColorStop(0.5, this.col(0.14, 0.28));
      rim.addColorStop(1, this.col(0, 0.3));
      ctx.fillStyle = rim;
      ctx.fillRect(-E, -E, E * 2, E * 2);
    }
    this.restPath(ctx);
    ctx.lineWidth = R * 0.014;
    ctx.strokeStyle = this.col(0.3, 0.35);
    ctx.stroke();
    // micro texture
    const grain = this.ensureGrain();
    ctx.globalAlpha=originalMaterial ? 1 : 0.55;
    ctx.drawImage(grain, -grain.width / 2, -grain.height / 2, grain.width, grain.height);
    ctx.globalAlpha=1;

    if (!originalMaterial) ctx.drawImage(this.ensureFormLight(), -E, -E, E * 2, E * 2);

    // ── surface tint goes UNDER the beads: a bead sitting half out of the gel
    // shows its own colour on top; only its submerged lower part is veiled,
    // and that is painted per bead by the meniscus sprite.
    const tint = ctx.createRadialGradient(-R * 0.15, -R * 0.2, R * 0.1, 0, 0, R * 1.05);
    tint.addColorStop(0, this.col(0.03, -0.1));
    tint.addColorStop(0.7, this.col(0.05, 0));
    tint.addColorStop(1, this.col(0.12, 0.08));
    ctx.fillStyle = tint;
    ctx.fillRect(-E, -E, E * 2, E * 2);

    // ── sockets + embedded beads (caller)
    inner(ctx);
    if (!originalMaterial) {
      // Low, rounded perimeter bead on the top face. It follows only the outer
      // silhouette: centre holes keep their own wall treatment and no gameplay
      // geometry changes. Broad colour carries the form; hairline shine only
      // marks the crest so the rim stays silicone rather than hard plastic.
      const ridge = ctx.createLinearGradient(-R, -R, R, R);
      ridge.addColorStop(0, "rgba(255,255,255,0.38)");
      ridge.addColorStop(0.42, this.col(0.24, -0.38));
      ridge.addColorStop(0.72, this.col(0.15, 0.04));
      ridge.addColorStop(1, this.col(0.27, 0.18));
      this.restPath(ctx, 0, 0.945, false);
      ctx.lineWidth = R * 0.06;
      ctx.strokeStyle = ridge;
      ctx.stroke();

      const crest = ctx.createLinearGradient(-R, -R, R * 0.6, R * 0.6);
      crest.addColorStop(0, "rgba(255,255,255,0.68)");
      crest.addColorStop(0.5, "rgba(255,255,255,0.18)");
      crest.addColorStop(1, "rgba(255,255,255,0.02)");
      this.restPath(ctx, 0, 0.966, false);
      ctx.lineWidth = Math.max(1, R * 0.009);
      ctx.strokeStyle = crest;
      ctx.stroke();

      this.restPath(ctx, 0, 0.908, false);
      ctx.lineWidth = Math.max(1, R * 0.011);
      ctx.strokeStyle = this.col(0.16, 0.22);
      ctx.stroke();
    }
    // inner Fresnel glow: a translucent slab's edges pick up ambient light
    this.restPath(ctx);
    ctx.lineWidth = R * (originalMaterial ? 0.05 : 0.026);
    ctx.strokeStyle = this.col(originalMaterial ? 0.34 : 0.25, -0.65);
    ctx.stroke();
    ctx.restore();
    // rim light along the top-left edge, fading around
    this.restPath(ctx);
    const rim = ctx.createLinearGradient(-R, -R, R * 0.7, R * 0.7);
    rim.addColorStop(0, "rgba(255,255,255,0.9)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.18)");
    rim.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.7;
    ctx.stroke();
    this.dirty = false;
    this.baseVersion++;
  }

  /** contact shadow as a texture (GL path); size in css px is 2.5R × 2.4R */
  private shadowTex: HTMLCanvasElement | null = null;
  private shadowR = -1;
  shadowTexture(dpr: number) {
    const R = this.R;
    if (this.shadowTex && this.shadowR === R) return this.shadowTex;
    this.shadowR = R;
    const w = Math.ceil(R * 2.5),
      h = Math.ceil(R * 2.4);
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    if (!originalMaterial) {
      ctx.translate(w / 2, h / 2);
      // Contact follows the real pad silhouette instead of a floating oval.
      ctx.filter = `blur(${R * .035}px)`;
      this.restPath(ctx, 0, .985);
      ctx.fillStyle = 'rgba(85,63,81,0.13)'; ctx.fill('evenodd');
      ctx.filter = 'none';
      this.shadowTex = c;
      return c;
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.5, w / 2, h / 2, R * 1.16);
    g.addColorStop(0, originalMaterial ? "rgba(75,70,78,0.2)" : "rgba(92,67,83,0.12)");
    g.addColorStop(0.72, "rgba(75,70,78,0.06)");
    g.addColorStop(1, "rgba(75,70,78,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, R * 1.14, R * 1.04, 0, 0, Math.PI * 2);
    ctx.fill();
    this.shadowTex = c;
    return c;
  }

  /** displace every grid vertex through warp() and map to device px (fills meshPos) */
  computeMesh(map: (x: number, y: number) => { x: number; y: number }) {
    const n = this.gridN;
    const E = this.texE;
    const cell = (E * 2) / n;
    const tmp = this.tmp;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        this.warp(-E + i * cell, -E + j * cell, tmp);
        const p = map(tmp.x, tmp.y);
        const k = j * (n + 1) + i;
        this.vx[k] = p.x;
        this.vy[k] = p.y;
        this.meshPos[k * 2] = p.x;
        this.meshPos[k * 2 + 1] = p.y;
      }
    }
  }

  /** draw a socket (empty hole) – for `inner` callbacks */
  drawSocket(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    const sp = getSocketSprite(r, this.texDpr, this.col(1));
    const w = sp.width / this.texDpr;
    ctx.drawImage(sp, x - w / 2, y - w / 2, w, w);
  }

  // ─── per-frame drawing ────────────────────────────────────────
  /** contact shadow on the table */
  drawShadow(ctx: CanvasRenderingContext2D) {
    const R = this.R;
    if (!originalMaterial) {
      ctx.drawImage(this.shadowTexture(1), -R * 1.25 + this.wobble.x * .15, -R * 1.2 + this.thick + R * .05, R * 2.5, R * 2.4);
      return;
    }
    ctx.save();
    ctx.translate(this.wobble.x * 0.15, this.thick + R * 0.05);
    const g = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.16);
    g.addColorStop(0, originalMaterial ? "rgba(75,70,78,0.2)" : "rgba(92,67,83,0.12)");
    g.addColorStop(0.72, "rgba(75,70,78,0.06)");
    g.addColorStop(1, "rgba(75,70,78,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.14, R * 1.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The base texture, pushed through the displacement field as an affine
   * mesh. `map` converts pad-local coords to device pixels (includes the
   * camera tilt and dpr). Leaves the canvas transform reset to identity.
   */
  drawMesh2D(ctx: CanvasRenderingContext2D) {
    const tex = this.tex;
    if (!tex) return;
    const n = this.gridN;
    const E = this.texE;
    const cell = (E * 2) / n;
    const vx = this.vx;
    const vy = this.vy;
    // draw each cell with its own affine transform (3 corners → parallelogram)
    const ts = tex.width / (E * 2); // texture px per local unit
    const ov = 0.35; // local px of overlap to hide hairline seams (fallback path only)
    const maxR = this.R * Math.max(...this.restR) * 1.02 + this.thick;
    ctx.save();
    ctx.globalAlpha = this.fade;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = -E + (i + 0.5) * cell;
        const cy = -E + (j + 0.5) * cell;
        if (Math.hypot(cx, Math.max(0, cy - this.thick * 0.5)) > maxR + cell) continue; // fully transparent cell
        const k00 = j * (n + 1) + i;
        const k10 = k00 + 1;
        const k01 = k00 + n + 1;
        const x00 = vx[k00],
          y00 = vy[k00];
        const a = (vx[k10] - x00) / cell;
        const b = (vy[k10] - y00) / cell;
        const c = (vx[k01] - x00) / cell;
        const d = (vy[k01] - y00) / cell;
        ctx.setTransform(a, b, c, d, x00, y00);
        const sx = (i * cell - ov) * ts;
        const sy = (j * cell - ov) * ts;
        const sw = (cell + ov * 2) * ts;
        ctx.drawImage(tex, sx, sy, sw, sw, -ov, -ov, cell + ov * 2, cell + ov * 2);
      }
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** dents from recent pops (animated → overlay) */
  drawDents(ctx: CanvasRenderingContext2D) {
    const tmp = this.tmp;
    for (const d of this.dents) {
      const k = 1 - d.t / d.life;
      const a = k * k;
      this.warp(d.x, d.y, tmp);
      const g = ctx.createRadialGradient(tmp.x, tmp.y, 0, tmp.x, tmp.y, d.r * 1.3);
      g.addColorStop(0, `rgba(60,50,62,${0.3 * a})`);
      g.addColorStop(0.6, `rgba(60,50,62,${0.1 * a})`);
      g.addColorStop(1, "rgba(60,50,62,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tmp.x, tmp.y, d.r * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(tmp.x, tmp.y, d.r * 0.9, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }

  /** finger dimples + sliding highlights, clipped to the live outline */
  drawSurface(ctx: CanvasRenderingContext2D) {
    const R = this.R;
    const s = R / 170;
    ctx.save();
    this.outlinePath(ctx);
    ctx.clip("evenodd");
    let hx = 0,
      hy = 0;
    for (const f of this.fingers.values()) {
      const p = f.press.x;
      if (p < 0.01) continue;
      hx += f.drag.x * 0.22 * p;
      hy += f.drag.y * 0.22 * p;
      const rr = 32 * s * (0.7 + 0.3 * p);
      // the dimple: shadow pooled toward the drag direction
      const g = ctx.createRadialGradient(f.x + f.drag.x * 0.25, f.y + f.drag.y * 0.25, 0, f.x, f.y, rr);
      g.addColorStop(0, `rgba(55,45,58,${0.24 * p})`);
      g.addColorStop(0.55, `rgba(55,45,58,${0.08 * p})`);
      g.addColorStop(1, "rgba(55,45,58,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
      ctx.fill();
      // stretched surface around the finger goes glossy
      const halo = ctx.createRadialGradient(f.x, f.y, rr * 0.9, f.x, f.y, rr * 2.2);
      halo.addColorStop(0, `rgba(255,255,255,${0.14 * p})`);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr * 2.2, 0, Math.PI * 2);
      ctx.fill();
      // rim of the dimple catches light – soft ring, brighter top-left
      const ring = ctx.createRadialGradient(f.x - 1.5, f.y - 1.5, rr * 0.55, f.x - 1.5, f.y - 1.5, rr * 0.95);
      ring.addColorStop(0, "rgba(255,255,255,0)");
      ring.addColorStop(0.55, `rgba(255,255,255,${0.3 * p})`);
      ring.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(f.x - 1.5, f.y - 1.5, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    const wx = this.wobble.x * 0.35 + hx;
    const wy = this.wobble.y * 0.35 + hy;
    // broad, blurry, irregular sheen: three soft blobs
    const blobs: [number, number, number, number, number, number][] = [
      [-0.3, -0.42, 0.55, 0.3, -0.55, originalMaterial ? 0.26 : 0.14],
      [-0.05, -0.55, 0.32, 0.18, -0.2, originalMaterial ? 0.16 : 0.10],
      [-0.5, -0.1, 0.22, 0.4, 0.4, originalMaterial ? 0.12 : 0.07],
    ];
    for (const [bx, by, rx, ry, rot, a] of blobs) {
      ctx.save();
      ctx.translate(bx * R + wx, by * R + wy);
      ctx.rotate(rot);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * rx);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.45, `rgba(255,255,255,${a * 0.45})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R * rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // sharp window reflection, long and thin, slides more than the sheen
    const streak = (x: number, y: number, len: number, wid: number, a: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.6);
      ctx.scale(1, wid / len);
      const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
      spec.addColorStop(0, `rgba(255,255,255,${a})`);
      spec.addColorStop(0.45, `rgba(255,255,255,${a * 0.6})`);
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(0, 0, len, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    streak(-R * 0.34 + wx * 1.5, -R * 0.52 + wy * 1.5, R * 0.28, R * (originalMaterial ? 0.05 : 0.09), originalMaterial ? 0.8 : 0.18);
    if (originalMaterial) streak(-R * 0.1 + wx * 1.5, -R * 0.4 + wy * 1.5, R * 0.09, R * 0.025, 0.5);
    ctx.restore();
  }
}

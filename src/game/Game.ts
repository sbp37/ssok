import { beadPos, generatePad, REF_PAD_R, type Bead } from "./beads/Bead";
import { getBeadSprite, getMeniscusSprite, getShadowSprite } from "./beads/BeadSprites";
import { Collector } from "./collector/Collector";
import { Gel } from "./gel/Gel";
import { MeshGL } from "./gel/MeshGL";
import { PointerInput, type PointerSample } from "./input/Pointer";
import { Pull, type PullEvent } from "./physics/pull";
import { Challenge, type ChallengeResult } from "./modes/Challenge";
import { records } from "./storage/records";
import { sfx } from "./audio/Sfx";
import { haptics } from "./haptics";
import { clamp, easeOutCubic, rng } from "./util/math";

export type Mode = "free" | "challenge";

export interface GameEvents {
  pop: { bead: Bead; score: number; combo: number; rare: boolean; pulled: number };
  firstPop: undefined;
  tick: { remaining: number; score: number; pulled: number; combo: number };
  challengeStart: undefined;
  challengeEnd: { result: ChallengeResult; isBest: boolean; best: ChallengeResult | null };
  padEmpty: undefined;
  slipped: undefined;
}

type Listener<T> = (payload: T) => void;

class Emitter<E extends object> {
  private map = new Map<keyof E, Set<Listener<never>>>();
  on<K extends keyof E>(k: K, fn: Listener<E[K]>) {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as Listener<never>);
    return () => s!.delete(fn as Listener<never>);
  }
  emit<K extends keyof E>(k: K, payload: E[K]) {
    this.map.get(k)?.forEach((fn) => (fn as Listener<E[K]>)(payload));
  }
}

interface Droplet {
  x: number;
  y: number;
  hx: number;
  hy: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
}
interface Flash {
  x: number;
  y: number;
  t: number;
}
interface FingerState {
  sample: PointerSample;
  lastMove: number;
}

/**
 * Orchestrates gel + beads + pulls + collector + modes and owns the frame loop.
 * Everything that *feels* like something is deliberately staggered by a few
 * tens of ms (see doPop) – simultaneous animation reads as weightless.
 */
export class Game extends Emitter<GameEvents> {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = 0;
  time = 0;

  gel = new Gel();
  beads: Bead[] = [];
  collector = new Collector();
  challenge = new Challenge(30);
  mode: Mode = "free";
  private pulls = new Map<number, Pull>();
  private fingers = new Map<number, FingerState>();
  private scheduled: { at: number; fn: () => void }[] = [];
  private droplets: Droplet[] = [];
  private flashes: Flash[] = [];
  private input: PointerInput;
  /** WebGL layer underneath the 2D canvas – draws only the gel mesh + its shadow */
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: MeshGL | null = null;
  private glBaseVersion = -1;
  private glShadowR = -1;
  private padCx = 0;
  private padCy = 0;
  private grabEnabled = true;
  private firstPopDone = false;
  private freePulled = 0;
  private tickAcc = 0;
  private ro: ResizeObserver;
  private tmp = { x: 0, y: 0 };
  /** `?test=5` → sparse 5-bead pad for tuning the hand-feel */
  private testBeads = (() => {
    const v = new URLSearchParams(location.search).get("test");
    return v ? Math.max(1, parseInt(v, 10) || 5) : 0;
  })();

  constructor(private canvas: HTMLCanvasElement) {
    super();
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    // gel layer: a WebGL canvas slipped under the 2D one (same size, pointer-events off)
    const glc = document.createElement("canvas");
    glc.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    canvas.parentElement?.insertBefore(glc, canvas);
    this.gl = MeshGL.create(glc);
    if (this.gl) {
      this.glCanvas = glc;
      this.gl.setGrid(this.gel.gridN);
    } else glc.remove();
    this.input = new PointerInput(canvas);
    this.input.onDown = this.onDown;
    this.input.onMove = this.onMove;
    this.input.onUp = this.onUp;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.newPad(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.destroy();
    this.glCanvas?.remove();
  }

  // ─── layout ───────────────────────────────────────────────────
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.glCanvas && this.gl) {
      this.glCanvas.width = this.canvas.width;
      this.glCanvas.height = this.canvas.height;
      this.gl.resize(this.canvas.width, this.canvas.height);
      this.glShadowR = -1;
    }
    const oldR = this.gel.R;
    this.gel.R = Math.min(this.w * 0.43, this.h * 0.305);
    this.padCx = this.w / 2;
    this.padCy = this.h * 0.455;
    const cw = clamp(this.w * 0.26, 84, 112);
    const ch = cw * 0.78;
    this.collector.layout(this.w - cw - 14, this.h - ch - 26, cw, ch);
    if (oldR > 0 && Math.abs(oldR - this.gel.R) > 0.5 && this.beads.length) {
      const k = this.gel.R / oldR;
      for (const b of this.beads) {
        b.rx *= k;
        b.ry *= k;
        b.radius *= k;
      }
      for (const s of this.gel.sockets) {
        s.x *= k;
        s.y *= k;
        s.r *= k;
      }
    }
    this.gel.markDirty();
  }

  private get s() {
    return this.gel.R / REF_PAD_R;
  }
  private toLocal(x: number, y: number) {
    return { x: x - this.padCx, y: (y - this.padCy) / this.gel.tilt };
  }
  private toCanvas(lx: number, ly: number) {
    return { x: lx + this.padCx, y: ly * this.gel.tilt + this.padCy };
  }

  // ─── public API ───────────────────────────────────────────────
  newPad(instant = false) {
    for (const p of this.pulls.values()) this.releaseBead(p.bead);
    this.pulls.clear();
    const boundary = (th: number) => this.gel.boundary(th);
    this.beads = this.testBeads
      ? generatePad(this.gel.R, rng, { surface: this.testBeads, deeper: false, spacing: 40, boundary })
      : generatePad(this.gel.R, rng, { boundary });
    this.gel.sockets = [];
    this.gel.dents = [];
    this.gel.fade = instant ? 1 : 0.15;
    this.droplets = [];
    this.gel.markDirty();
  }

  startChallenge() {
    this.mode = "challenge";
    this.newPad();
    this.collector.clear();
    this.challenge.start();
    this.grabEnabled = true;
    this.emit("challengeStart", undefined);
  }

  goFree() {
    this.mode = "free";
    this.challenge.running = false;
    this.grabEnabled = true;
    this.freePulled = 0;
    this.newPad();
    this.collector.clear();
  }

  get best() {
    return records.getBest("challenge30");
  }

  /** screen-space positions of currently grabbable beads (debug / e2e) */
  debugBeads() {
    const out: { id: number; x: number; y: number; r: number; type: string; layer: number; t1: number; t2: number }[] = [];
    for (const b of this.beads) {
      if (b.state !== "embedded") continue;
      if (b.layer === 1 && this.beads.some((o) => o.slot === b.slot && o.layer === 0 && o.state !== "collected" && o.state !== "gone" && o.state !== "flying")) continue;
      const p = beadPos(b);
      this.gel.warp(p.x, p.y, this.tmp);
      const c = this.toCanvas(this.tmp.x, this.tmp.y);
      const s = this.s;
      const deep = b.layer === 1 ? 1.25 : 1;
      out.push({ id: b.id, x: c.x, y: c.y, r: b.radius, type: b.type.id, layer: b.layer, t1: b.type.grip * s * deep, t2: b.type.grip * s * deep + b.type.pull * s * (b.layer === 1 ? 1.35 : 1) });
    }
    return out;
  }

  /** count of beads still grabbable (surface + surfaced deeper) */
  private remainingCount() {
    let n = 0;
    for (const b of this.beads) if (b.state === "embedded" || b.state === "held") n++;
    return n;
  }

  // ─── input ────────────────────────────────────────────────────
  private topBeadAt(lx: number, ly: number): Bead | null {
    let best: Bead | null = null;
    let bestD = Infinity;
    const tol = 9 * this.s;
    for (const b of this.beads) {
      if (b.state !== "embedded") continue;
      if (b.layer === 1 && this.beads.some((o) => o.slot === b.slot && o.layer === 0 && (o.state === "embedded" || o.state === "held"))) continue;
      const p = beadPos(b);
      this.gel.warp(p.x, p.y, this.tmp);
      const foot = b.type.shape === "oval" ? b.radius * (b.type.aspect ?? 1.7) * 0.78 : b.radius;
      const d = Math.hypot(this.tmp.x - lx, this.tmp.y - ly);
      if (d < foot + tol && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private onDown = (p: PointerSample) => {
    sfx.unlock();
    const l = this.toLocal(p.x, p.y);
    this.fingers.set(p.id, { sample: p, lastMove: performance.now() });
    if (!this.gel.inside(l.x, l.y) && !this.topBeadAt(l.x, l.y)) return;
    this.gel.fingerDown(p.id, l.x, l.y);
    sfx.press();
    haptics.press();
    if (!this.grabEnabled) return;
    const b = this.topBeadAt(l.x, l.y);
    if (b) {
      b.state = "held";
      this.pulls.set(p.id, new Pull(b, l.x, l.y, this.gel.R, () => rng.next()));
      this.gel.markDirty(); // the bead leaves the base texture while held
    }
  };

  private onMove = (p: PointerSample) => {
    const f = this.fingers.get(p.id);
    if (!f) return;
    f.sample = p;
    f.lastMove = performance.now();
    const l = this.toLocal(p.x, p.y);
    this.gel.fingerMove(p.id, l.x, l.y);
  };

  private onUp = (p: PointerSample) => {
    this.fingers.delete(p.id);
    this.gel.fingerUp(p.id);
    const pull = this.pulls.get(p.id);
    if (pull) {
      this.pulls.delete(p.id);
      this.releaseBead(pull.bead);
    }
  };

  private releaseBead(b: Bead) {
    if (b.state !== "held") return;
    b.state = "embedded";
    b.off.setTarget(0, 0);
    this.gel.markDirty();
    // let go while stretched → it snaps back and the gel shudders a bit
    const L = Math.hypot(b.off.x, b.off.y);
    if (L > 2) this.gel.recoil(-b.off.x * 3, -b.off.y * 3);
  }

  private handlePullEvents(pull: Pull, id: number, events: PullEvent[]) {
    const b = pull.bead;
    for (const e of events) {
      switch (e.kind) {
        case "tick":
          sfx.tick(b.type.mass, e.step);
          break;
        case "slipStart":
          sfx.stretch(b.type.mass);
          haptics.slipStart();
          break;
        case "slipped": {
          // "앗." – it slid back into the gel
          this.pulls.delete(id);
          b.state = "embedded";
          const ox = b.off.x;
          const oy = b.off.y;
          b.off.setTarget(0, 0);
          b.off.impulse(-ox * 12, -oy * 12);
          this.gel.reanchor(id);
          this.gel.markDirty();
          this.gel.addDent(b.rx + ox * 0.3, b.ry + oy * 0.3, b.radius * 0.8, 0.5);
          sfx.slipped();
          haptics.slipped();
          this.emit("slipped", undefined);
          break;
        }
        case "pop":
          this.doPop(b, id, e.dirX, e.dirY, e.speed);
          break;
      }
    }
  }

  // ─── the moment ───────────────────────────────────────────────
  private doPop(b: Bead, fingerId: number, dx: number, dy: number, speed: number) {
    const s = this.s;
    const rare = b.type.rarity === "rare";
    const pos = beadPos(b);
    this.pulls.delete(fingerId);
    this.gel.reanchor(fingerId);
    b.state = "flying";
    b.lift = 1;

    // kick toward the finger, then arc into the cup
    const kick = b.type.bounce * s * (1 + Math.min(speed, 1400) / 2800);
    const start = this.toCanvas(pos.x + dx * kick, pos.y + dy * kick);
    const end = this.collector.entry;
    const mx = (start.x + end.x) / 2 + dx * 30 * s;
    const my = Math.min(start.y, end.y) - (70 + 60 * Math.random()) * s;
    const dur = (0.46 + b.type.mass * 0.11) * (0.92 + Math.random() * 0.16);
    b.fly = {
      x0: start.x,
      y0: start.y,
      cx: mx,
      cy: my,
      x1: end.x,
      y1: end.y,
      t: 0,
      dur,
      kx: dx * kick,
      ky: dy * kick,
      px: pos.x,
      py: pos.y,
      spin: (Math.random() - 0.5) * 9,
    };

    // t = 0: sound + haptic land exactly with the release
    sfx.pop(b.type.sound, b.type.mass, rare);
    if (rare) this.schedule(0.05, () => haptics.rare());
    else haptics.pop(b.type.mass);

    // the socket is empty from now on
    const deeper = this.beads.find((o) => o.slot === b.slot && o.layer === 1 && o.state === "embedded" && o !== b);
    if (!deeper) this.gel.sockets.push({ x: b.rx, y: b.ry, r: b.radius * 0.92 });
    this.gel.markDirty();

    // +30ms: gel snaps back the other way, neck tears into droplets, dent appears
    this.schedule(0.03, () => {
      const m = Math.pow(b.type.mass, 0.6);
      this.gel.recoil(-dx * 95 * s * m, -dy * 95 * s * m);
      this.gel.addDent(b.rx, b.ry, b.radius * 1.15, 1.6 + b.type.mass * 0.3);
      const n = 2 + Math.round(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2;
        const sp = (90 + Math.random() * 120) * s;
        this.droplets.push({
          x: pos.x + dx * b.radius * 0.6,
          y: pos.y + dy * b.radius * 0.6,
          hx: b.rx,
          hy: b.ry,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          r: (1.5 + Math.random() * 2) * s,
          t: 0,
          life: 0.22 + Math.random() * 0.1,
        });
      }
    });
    // +40ms: the gel around the hole bulges outward and rings down – neighbours ride it
    this.schedule(0.04, () => this.gel.shock(b.rx, b.ry, b.radius, 5 * s * Math.pow(b.type.mass, 0.5)));
    // +120ms: the bead underneath rises to the surface
    if (deeper) this.schedule(0.12, () => (deeper.depth.target = 0));

    if (rare) this.flashes.push({ x: pos.x, y: pos.y, t: 0 });

    // scoring
    let score = b.type.score;
    let combo = 0;
    let pulled: number;
    if (this.mode === "challenge" && this.challenge.running) {
      const r = this.challenge.onPop(b);
      score = r.score;
      combo = r.combo;
      pulled = this.challenge.pulled;
    } else {
      this.freePulled++;
      pulled = this.freePulled;
    }
    this.emit("pop", { bead: b, score, combo, rare, pulled });
    if (!this.firstPopDone) {
      this.firstPopDone = true;
      this.emit("firstPop", undefined);
    }

    if (this.remainingCount() === 0) {
      if (this.mode === "challenge" && this.challenge.running) this.schedule(0.35, () => this.newPad());
      else this.schedule(0.4, () => this.emit("padEmpty", undefined));
    }
  }

  private endChallenge() {
    for (const p of this.pulls.values()) this.releaseBead(p.bead);
    this.pulls.clear();
    this.grabEnabled = false;
    const result = this.challenge.result();
    const { isBest } = records.submit("challenge30", result);
    sfx.chime(isBest);
    this.emit("challengeEnd", { result, isBest, best: records.getBest("challenge30") });
  }

  private schedule(delay: number, fn: () => void) {
    this.scheduled.push({ at: this.time + delay, fn });
  }

  // ─── loop ─────────────────────────────────────────────────────
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05; // tab switch etc.
    this.update(dt);
    this.render();
  };

  private update(dt: number) {
    this.time += dt;
    if (this.scheduled.length) {
      const due = this.scheduled.filter((s) => s.at <= this.time);
      if (due.length) {
        this.scheduled = this.scheduled.filter((s) => s.at > this.time);
        for (const s of due) s.fn();
      }
    }

    // held beads pull the gel around them
    this.gel.pulls.length = 0;
    for (const p of this.pulls.values()) {
      const b = p.bead;
      this.gel.pulls.push({ hx: b.rx, hy: b.ry, ox: b.off.x, oy: b.off.y, r: b.radius });
    }

    // springs: two substeps for stability at 30fps dips
    const sub = 2;
    const sdt = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.gel.step(sdt);
      for (const b of this.beads) {
        if (b.state === "flying" || b.state === "collected" || b.state === "gone") continue;
        b.off.step(sdt);
        b.depth.step(sdt);
        // embedded beads live in the base texture: re-render while they're still moving
        if (b.state === "embedded" && (!b.off.settled || !b.depth.settled)) this.gel.markDirty();
      }
    }

    // pulls
    const now = performance.now();
    for (const [id, pull] of [...this.pulls]) {
      const f = this.fingers.get(id);
      if (!f) continue;
      const l = this.toLocal(f.sample.x, f.sample.y);
      const speed = now - f.lastMove > 70 ? 0 : f.sample.speed;
      const events = pull.update(l.x, l.y, speed, dt);
      if (events.length) this.handlePullEvents(pull, id, events);
    }

    // beads
    for (const b of this.beads) {
      if (b.state === "embedded" && b.lift > 0) b.lift = Math.max(0, b.lift - dt * 5);
      if (b.state === "flying" && b.fly) {
        const f = b.fly;
        f.t += dt;
        if (f.t >= f.dur) {
          b.state = "collected";
          const vx = (f.x1 - f.cx) * 2;
          const vy = (f.y1 - f.cy) * 2;
          this.collector.add(b, vx, vy);
          sfx.land(b.type.material, b.type.mass);
          b.fly = undefined;
        }
      }
    }

    this.collector.step(dt);

    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.t += dt;
      // fly out, then get yanked back into the hole
      const k = d.t / d.life;
      const pull = 2600 * k;
      d.vx += (d.hx - d.x) * pull * dt - d.vx * 6 * dt;
      d.vy += (d.hy - d.y) * pull * dt - d.vy * 6 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.t >= d.life) this.droplets.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].t += dt;
      if (this.flashes[i].t > 0.55) this.flashes.splice(i, 1);
    }

    if (this.mode === "challenge" && this.challenge.running) {
      if (this.challenge.tick(dt)) this.endChallenge();
      this.tickAcc += dt;
      if (this.tickAcc > 0.05) {
        this.tickAcc = 0;
        this.emit("tick", {
          remaining: this.challenge.remaining,
          score: this.challenge.score,
          pulled: this.challenge.pulled,
          combo: this.challenge.combo,
        });
      }
    }
  }

  // ─── render ───────────────────────────────────────────────────
  private render() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const gel = this.gel;
    if (gel.needsBase) gel.renderBase((c) => this.drawBaseBeads(c));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // the gel itself: base texture through the displacement mesh
    const cx = this.padCx,
      cy = this.padCy,
      tilt = gel.tilt;
    const pt = { x: 0, y: 0 };
    const map = (x: number, y: number) => {
      pt.x = (x + cx) * dpr;
      pt.y = (y * tilt + cy) * dpr;
      return pt;
    };
    gel.computeMesh(map);
    if (this.gl) {
      const gl = this.gl;
      if (this.glBaseVersion !== gel.baseVersion && gel.baseTexture) {
        gl.setTexture("gel", gel.baseTexture);
        this.glBaseVersion = gel.baseVersion;
      }
      if (this.glShadowR !== gel.R) {
        gl.setTexture("shadow", gel.shadowTexture(dpr));
        this.glShadowR = gel.R;
      }
      gl.begin();
      // contact shadow quad (pad-local 2.5R × 2.4R, offset down by the slab thickness)
      const R = gel.R;
      const sx = gel.wobble.x * 0.15,
        sy = gel.thick + R * 0.05;
      const c: number[] = [];
      for (const [x, y] of [
        [sx - R * 1.25, sy - R * 1.2],
        [sx + R * 1.25, sy - R * 1.2],
        [sx - R * 1.25, sy + R * 1.2],
        [sx + R * 1.25, sy + R * 1.2],
      ]) {
        const q = map(x, y); // map() reuses one point – copy right away
        c.push(q.x, q.y);
      }
      gl.drawQuad("shadow", c, 1);
      gl.drawMesh("gel", gel.meshPos, gel.fade);
    } else {
      ctx.save();
      ctx.translate(this.padCx, this.padCy);
      ctx.scale(1, tilt);
      gel.drawShadow(ctx);
      ctx.restore();
      gel.drawMesh2D(ctx);
    }

    // dynamic overlays in pad space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.padCx, this.padCy);
    ctx.scale(1, tilt);
    gel.drawDents(ctx);
    gel.drawSurface(ctx);
    // beads being pulled: hole + neck + the bead lifting out
    for (const p of this.pulls.values()) {
      this.drawNeck(ctx, p.bead);
      this.drawEmbedded(ctx, p.bead, true);
    }
    if (this.droplets.length) {
      ctx.fillStyle = gel.col(0.9, -0.1);
      for (const d of this.droplets) {
        const k = 1 - d.t / d.life;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const f of this.flashes) {
      const k = f.t / 0.55;
      const a = (1 - k) * 0.7;
      const r = gel.R * (0.18 + k * 0.5);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.5, `rgba(255,250,235,${a * 0.35})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const b of this.beads) if (b.state === "flying" && b.fly) this.drawFlying(ctx, b);
    this.collector.draw(ctx, dpr);
  }

  /** everything embedded in the gel, at rest positions (the mesh does the moving) */
  private drawBaseBeads(ctx: CanvasRenderingContext2D) {
    const gel = this.gel;
    for (const s of gel.sockets) gel.drawSocket(ctx, s.x, s.y, s.r);
    const covered = new Set<number>();
    for (const b of this.beads) if (b.layer === 0 && (b.state === "embedded" || b.state === "held")) covered.add(b.slot);
    for (let layer = 1 as 0 | 1; layer >= 0; layer = (layer - 1) as 0 | 1) {
      for (const b of this.beads) {
        if (b.layer !== layer) continue;
        if (b.state === "held") {
          gel.drawSocket(ctx, b.rx, b.ry, b.radius * 0.95);
          continue;
        }
        if (b.state !== "embedded") continue;
        if (layer === 1 && covered.has(b.slot)) continue;
        this.drawEmbedded(ctx, b, false, true);
      }
    }
  }

  private drawEmbedded(ctx: CanvasRenderingContext2D, b: Bead, above = false, base = false) {
    const p = beadPos(b);
    if (base) {
      this.tmp.x = p.x;
      this.tmp.y = p.y;
    } else this.gel.warp(p.x, p.y, this.tmp);
    const depth = b.depth.x;
    const lift = b.lift;
    const scale = (1 - depth * 0.22) * (1 + lift * 0.2);
    const x = this.tmp.x;
    const y = this.tmp.y + depth * 3 * this.s - lift * 3 * this.s;
    const alpha = above ? 1 : 1 - depth * 0.55;
    const dpr = this.dpr;

    // shadow: tighter when embedded, lifts & offsets as the bead comes out
    const sh = getShadowSprite(b.radius * scale, dpr);
    ctx.globalAlpha = alpha * (0.55 + lift * 0.35);
    ctx.drawImage(sh.canvas, x - sh.w / 2 + lift * 4 * this.s, y - sh.h / 2 + b.radius * (0.18 + lift * 0.5), sh.w, sh.h);

    const sp = getBeadSprite(b.type, b.color, b.radius, dpr);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.rot);
    ctx.scale(scale, scale);
    if (!above) {
      // refraction ghost: the gel bends the bead's outline a hair
      ctx.globalAlpha = alpha * 0.22;
      ctx.drawImage(sp.canvas, -sp.w / 2 + 1.2 * this.s, -sp.h / 2 + 1.4 * this.s, sp.w, sp.h);
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
    // meniscus: gel climbing the bead, fades as it's pulled out / when deep
    const men = (1 - lift) * (1 - depth) * alpha;
    if (men > 0.02 && b.type.shape !== "oval") {
      const ms = getMeniscusSprite(b.radius * scale, dpr, this.gel.col(1));
      ctx.globalAlpha = men;
      ctx.drawImage(ms.canvas, x - ms.w / 2, y - ms.h / 2, ms.w, ms.h);
    }

    // rare beads twinkle faintly inside the gel
    if (b.type.rarity === "rare" && !above) {
      const tw = 0.35 + 0.35 * Math.sin(this.time * 3.2 + b.sparkle);
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

  /** the gel that clings to a bead being pulled – tents up, thins into a neck, strings, tears */
  private drawNeck(ctx: CanvasRenderingContext2D, b: Bead) {
    const ox = b.off.x;
    const oy = b.off.y;
    const L = Math.hypot(ox, oy);
    const p = clamp(b.lift, 0, 1);
    const r = b.radius;
    const gel = this.gel;
    gel.warp(b.rx, b.ry, this.tmp);
    const hx = this.tmp.x;
    const hy = this.tmp.y;
    // stretched hole: dark inside, widening with the pull
    const holeR = r * (1.0 + 0.18 * p);
    const hole = ctx.createRadialGradient(hx, hy, holeR * 0.2, hx, hy, holeR * 1.15);
    hole.addColorStop(0, `rgba(70,20,60,${0.32 + 0.1 * p})`);
    hole.addColorStop(0.75, `rgba(70,20,60,${0.12})`);
    hole.addColorStop(1, "rgba(70,20,60,0)");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(hx, hy, holeR * 1.15, 0, Math.PI * 2);
    ctx.fill();
    if (L < 0.8) return;
    const ux = ox / L;
    const uy = oy / L;
    const nx = -uy;
    const ny = ux;
    const bx = hx + ox;
    const by = hy + oy;
    // tent: the surface around the hole is lifted toward the bead – shade the far side, light the near side
    const tentR = r * (2.2 + 1.2 * p);
    const tg = ctx.createRadialGradient(hx - ux * r * 0.3, hy - uy * r * 0.3, r * 0.6, hx, hy, tentR);
    tg.addColorStop(0, `rgba(60,10,50,${0.16 * p})`);
    tg.addColorStop(0.5, `rgba(60,10,50,${0.06 * p})`);
    tg.addColorStop(1, "rgba(60,10,50,0)");
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(hx, hy, tentR, 0, Math.PI * 2);
    ctx.fill();
    const lg0 = ctx.createRadialGradient(hx + ux * r * 0.8, hy + uy * r * 0.8, 0, hx + ux * r * 0.8, hy + uy * r * 0.8, tentR * 0.8);
    lg0.addColorStop(0, `rgba(255,255,255,${0.22 * p})`);
    lg0.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lg0;
    ctx.beginPath();
    ctx.arc(hx, hy, tentR, 0, Math.PI * 2);
    ctx.fill();

    // neck: concave sides, thinnest near the bead
    const w0 = r * (1.05 + 0.15 * p);
    const w1 = r * (0.92 - 0.6 * p);
    const wm = r * (0.9 - 0.78 * p);
    const mx = hx + ox * 0.55;
    const my = hy + oy * 0.55;
    const neck = () => {
      ctx.beginPath();
      ctx.moveTo(hx + nx * w0, hy + ny * w0);
      ctx.quadraticCurveTo(mx + nx * wm, my + ny * wm, bx + nx * w1, by + ny * w1);
      ctx.arc(bx, by, w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
      ctx.quadraticCurveTo(mx - nx * wm, my - ny * wm, hx - nx * w0, hy - ny * w0);
      ctx.closePath();
    };
    // shadow the raised gel casts onto the pad
    ctx.save();
    ctx.translate(2 * this.s + p * 4, 3 * this.s + p * 6);
    neck();
    ctx.fillStyle = `rgba(70,20,60,${0.22 + p * 0.14})`;
    ctx.fill();
    ctx.restore();
    // body of the neck: stretched gel seen edge-on is a *thicker* light path → more colour, not less
    neck();
    ctx.fillStyle = gel.col(0.88, 0.1);
    ctx.fill();
    // cylindrical shading across the neck: lit edge → dark edge
    const lg = ctx.createLinearGradient(mx + nx * w0, my + ny * w0, mx - nx * w0, my - ny * w0);
    lg.addColorStop(0, "rgba(255,255,255,0.55)");
    lg.addColorStop(0.3, "rgba(255,255,255,0.12)");
    lg.addColorStop(0.65, "rgba(60,10,50,0.08)");
    lg.addColorStop(1, "rgba(60,10,50,0.32)");
    ctx.fillStyle = lg;
    ctx.fill();
    // specular line along the lit edge
    ctx.beginPath();
    ctx.moveTo(hx + nx * w0 * 0.85, hy + ny * w0 * 0.85);
    ctx.quadraticCurveTo(mx + nx * wm * 0.9, my + ny * wm * 0.9, bx + nx * w1 * 0.9, by + ny * w1 * 0.9);
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.2 * p})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // darker contour on the shaded side so the neck reads as a raised form
    ctx.beginPath();
    ctx.moveTo(hx - nx * w0, hy - ny * w0);
    ctx.quadraticCurveTo(mx - nx * wm, my - ny * wm, bx - nx * w1, by - ny * w1);
    ctx.strokeStyle = `rgba(90,30,80,${0.4 + 0.25 * p})`;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // the neck's own contact shadow where it meets the pad, on the shaded side
    ctx.beginPath();
    ctx.moveTo(hx - nx * w0 * 1.15, hy - ny * w0 * 1.15);
    ctx.quadraticCurveTo(mx - nx * wm * 1.5, my - ny * wm * 1.5, bx - nx * w1 * 1.4, by - ny * w1 * 1.4);
    ctx.strokeStyle = `rgba(90,30,80,${0.12 + 0.1 * p})`;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // gel still clinging to the back of the bead
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r * (1 + 0.12 * p), 0, Math.PI * 2);
    ctx.clip();
    const cg = ctx.createRadialGradient(bx - ux * r * 0.9, by - uy * r * 0.9, 0, bx - ux * r * 0.9, by - uy * r * 0.9, r * 1.4);
    cg.addColorStop(0, gel.col(0.75 * (1 - p * 0.6), -0.1));
    cg.addColorStop(1, gel.col(0, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(bx - r * 2, by - r * 2, r * 4, r * 4);
    ctx.restore();
  }

  private drawFlying(ctx: CanvasRenderingContext2D, b: Bead) {
    const f = b.fly!;
    const KICK = 0.09;
    let x: number, y: number;
    if (f.t < KICK) {
      const k = easeOutCubic(f.t / KICK);
      const c = this.toCanvas(f.px + f.kx * k, f.py + f.ky * k);
      x = c.x;
      y = c.y;
    } else {
      const t = clamp((f.t - KICK) / (f.dur - KICK), 0, 1);
      const e = t * t * (2 - t) * 0.5 + t * 0.5; // slight ease-in for weight
      const mt = 1 - e;
      x = mt * mt * f.x0 + 2 * mt * e * f.cx + e * e * f.x1;
      y = mt * mt * f.y0 + 2 * mt * e * f.cy + e * e * f.y1;
    }
    const dpr = this.dpr;
    const sh = getShadowSprite(b.radius, dpr);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(sh.canvas, x - sh.w / 2, y - sh.h / 2 + b.radius * 1.2, sh.w, sh.h);
    ctx.globalAlpha = 1;
    const sp = getBeadSprite(b.type, b.color, b.radius, dpr);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.rot + f.spin * f.t);
    const sc = 1.08 - Math.min(f.t / f.dur, 1) * 0.28; // shrinks as it "falls" into the cup
    ctx.scale(sc, sc);
    ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  }
}

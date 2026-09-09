import { beadPos, generatePad, REF_PAD_R, type Bead } from "./beads/Bead";
import { getBeadSprite, getMeniscusSprite, getShadowSprite, getContourMeniscus, invalidateBeadSprites } from "./beads/BeadSprites";
import { preloadBeadAssets, beadAsset } from './beads/BeadAssets';
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
import { PADS, padById, resolvePad, type PadType } from "./pads/PadTypes";
import { DiscoveryProvider, MockRewardedProvider, PadProgress, isRareVariant, type NextPadProvider, type RewardedUnlockProvider } from "./pads/progress";
import { DAY_NONE_FACTOR, FIRST_TREASURE_GUARANTEE, HIDDEN_POOLS, NONE, ULTRA_SURFACE_CHANCE } from "./rewards/rates";
import { ULTRA_TYPES } from "./beads/BeadTypes";
import { TreasureStore, treasureKind, type TreasureKind } from "./rewards/treasure";
import type { BeadType } from "./beads/BeadTypes";

export type Mode = "free" | "challenge";

export interface GameEvents {
  pop: { bead: Bead; score: number; combo: number; rare: boolean; pulled: number };
  firstPop: undefined;
  tick: { remaining: number; score: number; pulled: number; combo: number };
  challengeStart: undefined;
  challengeEnd: { result: ChallengeResult; isBest: boolean; best: ChallengeResult | null };
  padEmpty: undefined;
  slipped: undefined;
  /** free mode: how much of the current pad has been emptied */
  progress: { emptied: number; remaining: number; total: number };
  padChange: { pad: PadType; newPad: boolean; newVariant: boolean };
  /** a rare bead / hidden object / ultra landed in the treasure box */
  treasure: { type: BeadType; kind: TreasureKind; isNew: boolean; count: number; padName: string };
}

type Listener<T> = (payload: T) => void;

class Emitter<E extends object> {
  private map = new Map<keyof E, Set<Listener<never>>>();
  on<K extends keyof E>(k: K, fn: Listener<E[K]>) {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as Listener<never>);
    return () => {
      s!.delete(fn as Listener<never>);
    };
  }
  emit<K extends keyof E>(k: K, payload: E[K]) {
    this.map.get(k)?.forEach((fn) => (fn as Listener<E[K]>)(payload));
  }
}

/** Visual-only gel bridge: neck -> filament -> two retracting ends. */
interface Thread {
  hx: number;
  hy: number;
  bead: Bead;
  t: number;
  life: number;
  side: number;
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
  private threads: Thread[] = [];
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
  /** pads */
  progressStore = new PadProgress();
  nextProvider: NextPadProvider = new DiscoveryProvider();
  rewarded: RewardedUnlockProvider = new MockRewardedProvider();
  treasure = new TreasureStore();
  /** the pad after this one – rolled once (and saved) so NEXT, the door and a restart all agree */
  private pendingNext: PadType | null = null;
  /** what that next pad hides (null = nothing), rolled together with it */
  private pendingHidden: string | null | undefined = undefined;
  /** treasure to use for the pad being generated right now, when it was pre-rolled */
  private startHidden: string | null | undefined = undefined;
  /** while > time, the buried object is shown clearly (the "살짝 보기" hint) */
  private peekUntil = -1;
  private padTotal = 0;
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
    const forced = padById(new URLSearchParams(location.search).get("pad") ?? "");
    let pad = forced;
    if (!pad) {
      const prog = this.progressStore;
      if (prog.currentDone) {
        // emptied last time but never walked through the door → continue at the next pad, not the same one
        pad = (prog.nextId ? resolvePad(prog.nextId) : undefined) ?? this.nextProvider.next(prog);
        this.startHidden = prog.nextId ? prog.nextHidden : undefined;
        prog.open(pad);
      } else {
        pad = prog.current; // mid-pad exit → same pad, fresh
        // very first start: the pad on the table counts as discovered too
        if (!prog.isDiscovered(pad.variantOf ?? pad.id)) prog.open(pad);
      }
    }
    this.gel.setShape(pad);
    this.newPad(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    void preloadBeadAssets().then(()=>{invalidateBeadSprites();this.gel.markDirty();});
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
    // a proper jar: ~31% of the width, taller than wide, sitting just above the ad slot
    const cw = clamp(this.w * 0.31, 112, 136);
    const ch = cw * 1.08;
    this.collector.layout(this.w - cw - 14, this.h - ch - 14, cw, ch);
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
  /** where treasures fly to: the treasure-box button, top right */
  get treasureEntry() {
    return { x: this.w - 46, y: 96 };
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
    const hole = this.gel.hasHole ? (th: number) => this.gel.holeAt(th) : undefined;
    const preset = this.pad.beads;
    this.beads = this.testBeads
      ? generatePad(this.gel.R, rng, {
          surface: this.testBeads,
          deeper: false,
          spacing: 40,
          boundary,
          hole,
          // three distinct hand-feels side by side, then the two odd ones
          forceTypes: ["tiny", "pearl", "star", "marble", "long"],
        })
      : generatePad(this.gel.R, rng, {
          boundary,
          hole,
          // Shorter pads requested: keep type/deeper/treasure rolls unchanged.
          surface: Math.max(1, Math.round(preset.surface * 0.7)),
          raritySkew: preset.raritySkew,
          typeSkew: preset.typeSkew,
          rareCenterChance: preset.rareCenterChance,
          hiddenObject: this.hiddenForThisPad(),
          ultraChance: ULTRA_SURFACE_CHANCE,
        });
    this.padTotal = this.beads.length;
    this.peekUntil = -1;
    this.gel.sockets = [];
    this.gel.dents = [];
    this.gel.fade = instant ? 1 : 0.15;
    this.threads = [];
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
    this.emit("padChange", { pad: this.pad, newPad: false, newVariant: false });
    this.emitProgress();
  }

  get best() {
    return records.getBest("challenge30");
  }

  get pad(): PadType {
    return this.gel.pad;
  }

  /**
   * What a pad hides this time, from its weighted pool. "none" is a real
   * outcome, except for a new player's first pads; the first pad of a new day
   * makes "none" half as likely – that is the only daily difference.
   */
  private rollHidden(pad: PadType, dayBonus = false): string | null {
    const pool = HIDDEN_POOLS[pad.variantOf ?? pad.id];
    if (!pool?.length) return null;
    const guarantee = this.progressStore.totalCompleted < FIRST_TREASURE_GUARANTEE;
    const picked = rng.weighted(pool, (e) => (e.id === NONE ? (guarantee ? 0 : e.w * (dayBonus ? DAY_NONE_FACTOR : 1)) : e.w));
    return picked.id === NONE ? null : picked.id;
  }

  /** treasure for the pad being generated: the pre-rolled one if there is one, else a fresh roll */
  private hiddenForThisPad(): string | undefined {
    const day = this.progressStore.takeDayBonus();
    let h: string | null;
    if (this.startHidden !== undefined) {
      h = this.startHidden;
      this.startHidden = undefined;
      // the day's nudge still applies: an empty pre-roll gets one more chance
      if (h === null && day) h = this.rollHidden(this.pad, true);
    } else h = this.rollHidden(this.pad, day);
    return h ?? undefined;
  }

  /** the pad that comes after this one – rolled once, together with what it hides, and saved */
  get nextPad(): PadType {
    if (!this.pendingNext) {
      const prog = this.progressStore;
      const saved = prog.nextId ? resolvePad(prog.nextId) : undefined;
      if (saved && prog.nextHidden !== undefined) {
        this.pendingNext = saved;
        this.pendingHidden = prog.nextHidden;
      } else {
        this.pendingNext = this.nextProvider.next(prog);
        this.pendingHidden = this.rollHidden(this.pendingNext);
        prog.setNext(this.pendingNext, this.pendingHidden);
      }
    }
    return this.pendingNext;
  }

  /** everything the NEXT tease is allowed to know */
  get nextInfo() {
    const pad = this.nextPad;
    const rare = isRareVariant(pad);
    return {
      pad,
      rare,
      rareNew: rare && !this.progressStore.isVariantDiscovered(pad.id),
      ultra: !!this.pendingHidden && ULTRA_TYPES.some((t) => t.id === this.pendingHidden),
      collection: this.progressStore.mode === "COLLECTION",
    };
  }

  /** is the next pad a rare variant passing by? (the only thing an ad is offered for) */
  get nextIsRare() {
    return isRareVariant(this.nextPad);
  }

  /** the buried object of the current pad, and whether it has never been found before */
  get hiddenInfo() {
    const b = this.beads.find((x) => x.hidden && (x.state === "embedded" || x.state === "held"));
    if (!b) return null;
    return { type: b.type, isNew: !this.treasure.has(b.type.id) };
  }

  /** show the buried object clearly for a moment (after "광고 보고 살짝 보기") */
  peekHidden(seconds = 1.8) {
    this.peekUntil = this.time + seconds;
    this.gel.markDirty();
    this.schedule(seconds + 0.02, () => this.gel.markDirty());
  }

  /**
   * switch to a pad: reshape the gel, fresh beads. The jar holds *this pad's*
   * beads, so it is tidied away now – briefly, not wiped in one frame.
   */
  openPad(pad: PadType) {
    this.collector.dismiss();
    // the treasure rolled for NEXT travels with it; a different pad rolls fresh
    this.startHidden = this.pendingNext && this.pendingNext.id === pad.id ? this.pendingHidden : undefined;
    const { newPad, newVariant } = this.progressStore.open(pad);
    this.gel.setShape(pad);
    this.newPad();
    this.glShadowR = -1; // silhouette-shaped shadow changes even at the same R
    this.pendingNext = null;
    this.pendingHidden = undefined;
    this.emit("padChange", { pad, newPad, newVariant });
    this.emitProgress();
  }

  /** let a rare variant pass: open the plain version of that pad instead */
  openNextPlain() {
    const base = padById(this.nextPad.id)!;
    this.openPad(base);
  }

  /** test/QA: empty the pad instantly (beads vanish, treasures are credited, completion logic runs) */
  debugFinishPad() {
    for (const b of this.beads)
      if (b.state === "embedded" || b.state === "held") {
        b.state = "collected";
        if (treasureKind(b.type)) this.treasure.add(b.type.id);
      }
    this.pulls.clear();
    this.gel.markDirty();
    this.progressStore.complete();
    this.emitProgress();
    this.emit("padEmpty", undefined);
  }

  private emitProgress() {
    const remaining = this.remainingCount();
    const total = this.padTotal || 1;
    this.emit("progress", { emptied: 1 - remaining / total, remaining, total });
  }

  static readonly PADS = PADS;

  /** screen-space positions of currently grabbable beads (debug / e2e) */
  debugBeads() {
    const out: { id: number; x: number; y: number; r: number; type: string; layer: number; hidden: boolean; t1: number; t2: number }[] = [];
    for (const b of this.beads) {
      if (b.state !== "embedded") continue;
      if (b.layer === 1 && this.beads.some((o) => o.slot === b.slot && o.layer === 0 && o.state !== "collected" && o.state !== "gone" && o.state !== "flying")) continue;
      const p = beadPos(b);
      this.gel.warp(p.x, p.y, this.tmp);
      const c = this.toCanvas(this.tmp.x, this.tmp.y);
      const s = this.s;
      const deep = b.layer === 1 ? 1.25 : 1;
      out.push({ id: b.id, x: c.x, y: c.y, r: b.radius, type: b.type.id, layer: b.layer, hidden: !!b.hidden, t1: b.type.grip * s * deep, t2: b.type.grip * s * deep + b.type.pull * s * (b.layer === 1 ? 1.35 : 1) });
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
      // accept the bead where it is drawn *or* where it rests – the gel may still be ringing from a pop
      const d = Math.min(Math.hypot(this.tmp.x - lx, this.tmp.y - ly), Math.hypot(p.x - lx, p.y - ly));
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
      const R = this.gel.R;
      const resist = this.pad.grip * (this.pad.resistance?.(b.rx / R, b.ry / R) ?? 1);
      this.pulls.set(p.id, new Pull(b, l.x, l.y, R, () => rng.next(), resist));
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
      this.releaseBead(pull.bead, pull);
    }
  };

  private releaseBead(b: Bead, pull?: Pull) {
    if (b.state !== "held") return;
    b.state = "embedded";
    b.off.setTarget(0, 0);
    this.gel.markDirty();
    // let go while stretched → the gel takes the bead back with a small shudder
    const sx = (pull?.stretch.x ?? 0) + b.off.x;
    const sy = (pull?.stretch.y ?? 0) + b.off.y;
    const L = Math.hypot(sx, sy);
    if (L > 3) {
      this.gel.recoil(-sx * 2.2, -sy * 2.2);
      this.gel.shock(b.rx, b.ry, b.radius, Math.min(4, L * 0.25) * this.s);
      sfx.release(b.type.mass);
    }
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

    // 0ms: freed – kicks toward the finger, hangs there ~150ms so the moment lands, then arcs into the cup
    // (treasures arc up to the treasure box instead)
    const kick = b.type.bounce * s * (1 + Math.min(speed, 1400) / 2800);
    const start = this.toCanvas(pos.x + dx * kick, pos.y + dy * kick);
    const kind = treasureKind(b.type);
    const end = kind ? this.treasureEntry : this.collector.entry;
    const mx = (start.x + end.x) / 2 + dx * 30 * s;
    const my = Math.min(start.y, end.y) - (70 + 60 * Math.random()) * s;
    const dur = (0.46 + b.type.mass * 0.11) * (0.92 + Math.random() * 0.16);
    const hang = 0.12 + b.type.mass * 0.03;
    b.fly = {
      hang,
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
    sfx.pop(b.type.sound, b.type.mass, rare || !!kind);
    if (kind) this.schedule(0.05, () => haptics.rare());
    else haptics.pop(b.type.mass);
    if (kind === "ultra") this.schedule(0.12, () => sfx.chime(true));

    // the socket is empty from now on
    const deeper = this.beads.find((o) => o.slot === b.slot && o.layer === 1 && o.state === "embedded" && o !== b);
    if (!deeper) this.gel.sockets.push({ x: b.rx, y: b.ry, r: b.radius * 0.92 });
    this.gel.markDirty();

    // Visual only: does not postpone POP, input, or the flight into the jar.
    this.threads.push({ hx: b.rx, hy: b.ry, bead: b, t: 0, life: 0.19, side: Math.random() < 0.5 ? -1 : 1 });
    // +30ms: gel snaps back the other way, dent appears
    this.schedule(0.03, () => {
      const m = Math.pow(b.type.mass, 0.6);
      this.gel.recoil(-dx * 95 * s * m, -dy * 95 * s * m);
      this.gel.addDent(b.rx, b.ry, b.radius * 1.15, 1.6 + b.type.mass * 0.3);
    });
    // +40ms: the gel around the hole bulges outward and rings down – neighbours ride it
    this.schedule(0.04, () => this.gel.shock(b.rx, b.ry, b.radius, 5 * s * Math.pow(b.type.mass, 0.5)));
    // +120ms: the bead underneath rises to the surface
    if (deeper) this.schedule(0.12, () => (deeper.depth.target = 0));

    if (kind) this.flashes.push({ x: pos.x, y: pos.y, t: 0 });

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
    if (this.mode === "free") this.emitProgress();

    if (this.remainingCount() === 0) {
      if (this.mode === "challenge" && this.challenge.running) this.schedule(0.35, () => this.newPad());
      else {
        this.progressStore.complete();
        this.schedule(0.4, () => this.emit("padEmpty", undefined));
      }
    }
  }

  private endChallenge() {
    for (const p of this.pulls.values()) this.releaseBead(p.bead, p);
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
      this.gel.pulls.push({ hx: b.rx, hy: b.ry, sx: p.stretch.x + b.off.x * 0.5, sy: p.stretch.y + b.off.y * 0.5, r: b.radius });
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
        if (f.t >= f.hang + f.dur) {
          b.state = "collected";
          const kind = treasureKind(b.type);
          if (kind) {
            const isNew = this.treasure.add(b.type.id);
            sfx.land("glass", b.type.mass * 0.6);
            this.emit("treasure", { type: b.type, kind, isNew, count: this.treasure.count(b.type.id), padName: this.pad.name });
          } else {
            const vx = (f.x1 - f.cx) * 2;
            const vy = (f.y1 - f.cy) * 2;
            this.collector.add(b, vx, vy);
            sfx.land(b.type.material, b.type.mass);
          }
          b.fly = undefined;
        }
      }
    }

    this.collector.step(dt);

    for (let i = this.threads.length - 1; i >= 0; i--) {
      const th = this.threads[i];
      th.t += dt;
      if (th.t >= th.life || th.bead.state !== "flying") this.threads.splice(i, 1);
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
      gl.drawMesh("gel", gel.meshPos, gel.fade, gel.materialLights());
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
      this.drawNeck(ctx, p.bead, p);
      this.drawEmbedded(ctx, p.bead, true);
    }
    for (const th of this.threads) this.drawThread(ctx, th);
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
    const emptied = this.padTotal ? 1 - this.remainingCount() / this.padTotal : 0;
    for (let layer = 1 as 0 | 1; layer >= 0; layer = (layer - 1) as 0 | 1) {
      for (const b of this.beads) {
        if (b.layer !== layer) continue;
        if (b.state === "held") {
          gel.drawSocket(ctx, b.rx, b.ry, b.radius * 0.95);
          continue;
        }
        if (b.state !== "embedded") continue;
        if (layer === 1 && covered.has(b.slot)) {
          // the hidden object is bigger than the bead sitting on it: its edges show
          // around the host, fading in as the pad empties – "what's that in there?"
          if (b.hidden) {
            const vis = this.pad.hiddenVisibility ?? 1;
            const peek = this.time < this.peekUntil;
            ctx.globalAlpha = peek ? 0.85 : (0.12 + 0.55 * clamp(emptied * 1.4, 0, 1)) * vis;
            this.drawEmbedded(ctx, b, false, true);
            ctx.globalAlpha = 1;
          }
          continue;
        }
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
    const alpha = (above ? 1 : 1 - depth * 0.5) * ctx.globalAlpha;
    const dpr = this.dpr;

    // shadow: tighter when embedded, lifts & offsets as the bead comes out
    const sh = getShadowSprite(b.radius * scale, dpr);
    ctx.globalAlpha = alpha * (0.55 + lift * 0.35);
    ctx.drawImage(sh.canvas, x - sh.w / 2 + lift * 4 * this.s, y - sh.h / 2 + b.radius * (0.18 + lift * 0.5), sh.w, sh.h);

    // seen through gel → a softened sprite variant (blur baked in, cached); crisp once it lifts out
    const sp = getBeadSprite(b.type, b.color, b.radius, dpr, base ? depth * 0.7 * this.s : 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.rot);
    ctx.scale(scale, scale);
    if (!above && depth > 0.15) {
      // refraction ghost: the gel bends the bead's outline a hair
      ctx.globalAlpha = alpha * depth * 0.12;
      ctx.drawImage(sp.canvas, -sp.w / 2 + 1.2 * this.s, -sp.h / 2 + 1.4 * this.s, sp.w, sp.h);
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
    // meniscus: gel climbing the bead, fades as it's pulled out / when deep
    const men = (1 - lift) * (1 - depth) * alpha;
    if (men > 0.02 && b.type.shape !== "oval") {
      const ms = beadAsset(b.type)
        ? getContourMeniscus(b.type,b.color,b.radius*scale,dpr,this.gel.col(1))
        : getMeniscusSprite(b.radius * scale, dpr, this.gel.col(1));
      ctx.globalAlpha = men;
      ctx.save();ctx.translate(x,y);ctx.rotate(beadAsset(b.type)?b.rot:0);ctx.translate(-x,-y);
      ctx.drawImage(ms.canvas, x - ms.w / 2, y - ms.h / 2, ms.w, ms.h);
      ctx.restore();
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

  /**
   * The gel holding a bead that is being pulled. Driven by *tension* and the
   * gel stretch vector, not by how far the bead has moved – in the grip stage
   * the bead sits still while the meniscus goes oval toward the finger and the
   * surface tents; only in the slip stage does a thinning neck appear.
   */
  private drawNeck(ctx: CanvasRenderingContext2D, b: Bead, pull: Pull) {
    const gel = this.gel;
    const r = b.radius;
    const s = this.s;
    const T = pull.tension;
    const P = pull.progress;
    if (T < 0.02) return;
    gel.warp(b.rx, b.ry, this.tmp);
    const hx = this.tmp.x;
    const hy = this.tmp.y;
    const stx = pull.stretch.x;
    const sty = pull.stretch.y;
    const L = Math.hypot(stx, sty);
    const ux = L > 0.5 ? stx / L : pull.dirX;
    const uy = L > 0.5 ? sty / L : pull.dirY;
    const nx = -uy;
    const ny = ux;
    const bx = hx + b.off.x;
    const by = hy + b.off.y;
    const offL = Math.hypot(b.off.x, b.off.y);

    // ── tent: surface around the socket lifted toward the finger.
    // dark on the far side (steep, in shadow), bright bulge on the near side.
    const tentR = r * (1.7 + 0.8 * T + 0.4 * P);
    const far = ctx.createRadialGradient(hx - ux * r * 0.6, hy - uy * r * 0.6, r * 0.4, hx - ux * r * 0.3, hy - uy * r * 0.3, tentR);
    far.addColorStop(0, gel.col(0.19 * T, 0.35));
    far.addColorStop(0.5, gel.col(0.055 * T, 0.25));
    far.addColorStop(1, "rgba(55,45,58,0)");
    ctx.fillStyle = far;
    ctx.beginPath();
    ctx.arc(hx, hy, tentR, 0, Math.PI * 2);
    ctx.fill();
    const nearX = hx + ux * (r * 0.9 + L * 0.8);
    const nearY = hy + uy * (r * 0.9 + L * 0.8);
    const near = ctx.createRadialGradient(nearX, nearY, 0, nearX, nearY, tentR * 0.75);
    near.addColorStop(0, `rgba(255,255,255,${0.26 * T})`);
    near.addColorStop(0.5, `rgba(255,255,255,${0.08 * T})`);
    near.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = near;
    ctx.beginPath();
    ctx.arc(nearX, nearY, tentR * 0.75, 0, Math.PI * 2);
    ctx.fill();

    // ── oval meniscus: the gel lip gripping the bead is dragged a little toward the finger.
    // Soft gradient rings (no hard strokes) drawn in a scaled space so they are elliptical.
    const cx = hx + ux * L * 0.3 + b.off.x * 0.35;
    const cy = hy + uy * L * 0.3 + b.off.y * 0.35;
    const across = r * (1.12 - 0.1 * P);
    const along = across + L * 0.42 + offL * 0.3;
    const rot = Math.atan2(uy, ux);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(along / across, 1);
    // glossy stretched surface just outside the bead
    const gloss = ctx.createRadialGradient(0, 0, across * 0.8, 0, 0, across * 1.5);
    gloss.addColorStop(0, `rgba(255,255,255,${0.1 + 0.12 * T})`);
    gloss.addColorStop(0.5, `rgba(255,255,255,${0.05 * T})`);
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // contact shadow ring outside the lip
    const ao = ctx.createRadialGradient(0, 0, across * 1.02, 0, 0, across * 1.42);
    ao.addColorStop(0, `rgba(55,45,58,${0.26 + 0.12 * T})`);
    ao.addColorStop(0.45, `rgba(55,45,58,${0.08 + 0.04 * T})`);
    ao.addColorStop(1, "rgba(55,45,58,0)");
    ctx.fillStyle = ao;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.42, 0, Math.PI * 2);
    ctx.fill();
    // the lip: bright thin ring, brighter toward the finger
    const lip = ctx.createRadialGradient(0, 0, across * 0.94, 0, 0, across * 1.22);
    lip.addColorStop(0, "rgba(255,255,255,0)");
    lip.addColorStop(0.35, `rgba(255,255,255,${0.42 + 0.3 * T})`);
    lip.addColorStop(0.7, `rgba(255,255,255,${0.12 + 0.08 * T})`);
    lip.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lip;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.22, 0, Math.PI * 2);
    ctx.fill();
    // finger-side of the lip catches more light
    const side = ctx.createLinearGradient(-across, 0, across, 0);
    side.addColorStop(0, "rgba(255,255,255,0)");
    side.addColorStop(0.6, "rgba(255,255,255,0)");
    side.addColorStop(1, `rgba(255,255,255,${0.35 * T})`);
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── socket: dark, deepens with pull
    const holeR = r * (0.92 + 0.22 * P);
    const hole = ctx.createRadialGradient(hx, hy, holeR * 0.15, hx, hy, holeR * 1.1);
    hole.addColorStop(0, `rgba(55,45,58,${0.18 + 0.2 * T + 0.14 * P})`);
    hole.addColorStop(0.7, `rgba(55,45,58,${0.08 + 0.06 * P})`);
    hole.addColorStop(1, "rgba(55,45,58,0)");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(hx, hy, holeR * 1.1, 0, Math.PI * 2);
    ctx.fill();

    // ── neck (slip stage): a concave bridge from the lip to the bead that thins as it goes
    if (offL > r * 0.35) {
      const w0 = across * (1.0 + 0.08 * P);
      const w1 = r * (0.9 - 0.62 * P);
      const wm = r * (0.86 - 0.74 * P);
      const mx = hx + b.off.x * 0.55;
      const my = hy + b.off.y * 0.55;
      const neck = () => {
        ctx.beginPath();
        ctx.moveTo(hx + nx * w0, hy + ny * w0);
        ctx.quadraticCurveTo(mx + nx * wm, my + ny * wm, bx + nx * w1, by + ny * w1);
        ctx.arc(bx, by, w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
        ctx.quadraticCurveTo(mx - nx * wm, my - ny * wm, hx - nx * w0, hy - ny * w0);
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(2 * s + P * 4, 3 * s + P * 6);
      neck();
      ctx.fillStyle = gel.col(0.12 + P * 0.07, 0.35);
      ctx.fill();
      ctx.restore();
      neck();
      ctx.fillStyle = gel.col(0.62 - P * 0.16, -0.03);
      ctx.fill();
      const lg = ctx.createLinearGradient(mx + nx * w0, my + ny * w0, mx - nx * w0, my - ny * w0);
      lg.addColorStop(0, "rgba(255,255,255,0.4)");
      lg.addColorStop(0.3, "rgba(255,255,255,0.12)");
      lg.addColorStop(0.65, "rgba(55,45,58,0.08)");
      lg.addColorStop(1, gel.col(0.25, 0.35));
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx + nx * w0 * 0.85, hy + ny * w0 * 0.85);
      ctx.quadraticCurveTo(mx + nx * wm * 0.9, my + ny * wm * 0.9, bx + nx * w1 * 0.9, by + ny * w1 * 0.9);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.2 * P})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - nx * w0, hy - ny * w0);
      ctx.quadraticCurveTo(mx - nx * wm, my - ny * wm, bx - nx * w1, by - ny * w1);
      ctx.strokeStyle = gel.col(0.18 + 0.1 * P, 0.3);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // gel still clinging to the back of the bead
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r * (1 + 0.12 * P), 0, Math.PI * 2);
    ctx.clip();
    const cg = ctx.createRadialGradient(bx - ux * r * 0.9, by - uy * r * 0.9, 0, bx - ux * r * 0.9, by - uy * r * 0.9, r * 1.4);
    cg.addColorStop(0, gel.col(0.7 * (1 - P * 0.6), -0.1));
    cg.addColorStop(1, gel.col(0, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(bx - r * 2, by - r * 2, r * 4, r * 4);
    ctx.restore();
  }

  /** A tapering translucent bridge, then two short ends that recoil after rupture. */
  private drawThread(ctx: CanvasRenderingContext2D, th: Thread) {
    const b = th.bead;
    if (!b.fly) return;
    const k = Math.min(1, th.t / 0.115);
    const recoil = Math.max(0, (th.t - 0.115) / (th.life - 0.115));
    const p = this.flyPos(b);
    const bx = p.x - this.padCx;
    const by = (p.y - this.padCy) / this.gel.tilt;
    this.gel.warp(th.hx, th.hy, this.tmp);
    const hx = this.tmp.x;
    const hy = this.tmp.y;
    const dx = bx - hx;
    const dy = by - hy;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const ex = bx - dx / L * b.radius * 0.75;
    const ey = by - dy / L * b.radius * 0.75;
    const sag = th.side * 3 * this.s * k;
    const mx = (hx + ex) * 0.5 + nx * sag;
    const my = (hy + ey) * 0.5 + ny * sag;
    ctx.save();
    ctx.lineCap = 'round';
    if (recoil === 0) {
      // A wide foot remains attached to the socket while the middle narrows.
      const root = b.radius * (0.42 - k * 0.30);
      const tip = b.radius * (0.26 - k * 0.20);
      const waist = Math.max(0.35 * this.s, b.radius * 0.13 * (1 - k));
      ctx.beginPath();
      ctx.moveTo(hx + nx * root, hy + ny * root);
      ctx.bezierCurveTo(hx + dx * 0.16 + nx * waist, hy + dy * 0.16 + ny * waist, mx + nx * waist, my + ny * waist, ex + nx * tip, ey + ny * tip);
      ctx.lineTo(ex - nx * tip, ey - ny * tip);
      ctx.bezierCurveTo(mx - nx * waist, my - ny * waist, hx + dx * 0.16 - nx * waist, hy + dy * 0.16 - ny * waist, hx - nx * root, hy - ny * root);
      ctx.closePath();
      ctx.fillStyle = this.gel.col(0.66, -0.08); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - nx * root * 0.6, hy - ny * root * 0.6);
      ctx.quadraticCurveTo(mx - nx * waist, my - ny * waist, ex, ey);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(0.45, 0.85 * this.s); ctx.stroke();
    } else {
      // Endpoints separate immediately at rupture. No strand follows to the jar.
      const tail = Math.pow(1 - recoil, 2) * 0.43;
      const curl = th.side * Math.sin(recoil * Math.PI) * 5 * this.s;
      ctx.globalAlpha = 1 - recoil;
      ctx.strokeStyle = this.gel.col(0.9, -0.1);
      ctx.lineWidth = (0.8 + recoil * 0.7) * this.s;
      ctx.beginPath(); ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(hx + (mx - hx) * tail + nx * curl, hy + (my - hy) * tail + ny * curl, hx + (ex - hx) * tail, hy + (ey - hy) * tail);
      ctx.moveTo(ex, ey);
      ctx.quadraticCurveTo(ex + (mx - ex) * tail - nx * curl, ey + (my - ey) * tail - ny * curl, ex + (hx - ex) * tail * 0.6, ey + (hy - ey) * tail * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** screen position of a flying bead: kick → hang near the socket → arc to the cup */
  private flyPos(b: Bead) {
    const f = b.fly!;
    const KICK = 0.09;
    if (f.t < KICK) {
      const k = easeOutCubic(f.t / KICK);
      return this.toCanvas(f.px + f.kx * k, f.py + f.ky * k);
    }
    if (f.t < f.hang) {
      // hangs where it landed, drifting back a hair and bobbing once – time to feel the pop
      const u = (f.t - KICK) / (f.hang - KICK);
      const back = -0.14 * Math.sin(u * Math.PI);
      return this.toCanvas(f.px + f.kx * (1 + back), f.py + f.ky * (1 + back) - Math.sin(u * Math.PI) * 3 * this.s);
    }
    const t = clamp((f.t - f.hang) / f.dur, 0, 1);
    const e = t * t * (2 - t) * 0.5 + t * 0.5;
    const mt = 1 - e;
    return {
      x: mt * mt * f.x0 + 2 * mt * e * f.cx + e * e * f.x1,
      y: mt * mt * f.y0 + 2 * mt * e * f.cy + e * e * f.y1,
    };
  }

  private drawFlying(ctx: CanvasRenderingContext2D, b: Bead) {
    const f = b.fly!;
    const { x, y } = this.flyPos(b);
    const dpr = this.dpr;
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
    const sc = 1.12 - flyT * (toBox ? 0.55 : 0.3); // lifted while it hangs, shrinks as it "falls" into the cup / box
    ctx.scale(sc, sc);
    ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  }
}

import { beadPos, generatePad, REF_PAD_R, type Bead } from "./beads/Bead";
import { invalidateBeadSprites } from "./beads/BeadSprites";
import { preloadBeadAssets } from "./beads/BeadAssets";
import { Collector } from "./collector/Collector";
import { Gel } from "./gel/Gel";
import { MeshGL } from "./gel/MeshGL";
import { PointerInput, type PointerSample } from "./input/Pointer";
import { Pull, pullSizeStrength, type PullEvent } from "./physics/pull";
import { sfx } from "./audio/Sfx";
import { haptics } from "./haptics";
import { clamp, rng } from "./util/math";
import { Emitter } from "./util/Emitter";
import { PerfProbe } from "./util/PerfProbe";
import { PullNeckRenderer } from "./render/PullNeck";
import { drawFlying, drawThread, type PadView, type Thread } from "./render/Flight";
import { beadFit, drawEmbeddedBead, embeddedPosition, embeddedScale } from "./render/EmbeddedBead";
import { drawFinishStar, drawJarFinale, drawPadFinale, FINALE_DURATION } from "./render/Finale";
import { PADS, padById, resolvePad, type PadType } from "./pads/PadTypes";
import { DiscoveryProvider, PadProgress, isRareVariant, type NextPadProvider } from "./pads/progress";
import { roundBeadBudget } from "./pads/pacing";
import { DAY_NONE_FACTOR, FIRST_TREASURE_GUARANTEE, HIDDEN_POOLS, NONE, ULTRA_SURFACE_CHANCE } from "./rewards/rates";
import { ULTRA_TYPES } from "./beads/BeadTypes";
import { TreasureStore, treasureKind, type TreasureKind } from "./rewards/treasure";
import type { BeadType } from "./beads/BeadTypes";
import { chainCount, chainFraction, isChain, revealsBead, exposedFiber, fiberPoint, FiberPull, relaxFiber, type FiberPoint } from "./fibers/Fiber";
import { drawFiber } from "./fibers/FiberRenderer";
import { installTactile, installOpeningTactiles, installRoundTactiles, roundTactile, tactileHint, type TactileKind } from "./fibers/Tactile";
import { drawChain, drawPeel, drawSwirl } from "./fibers/TactileRenderer";

export interface GameEvents {
  pop: { bead: Bead; rare: boolean; pulled: number };
  firstPop: undefined;
  padEmpty: undefined;
  slipped: undefined;
  /** how much of the current pad has been emptied */
  progress: { emptied: number; remaining: number; total: number };
  padChange: { pad: PadType; newPad: boolean; newVariant: boolean };
  /** a rare bead / hidden object / ultra landed in the treasure box */
  treasure: { type: BeadType; kind: TreasureKind; isNew: boolean; count: number; padName: string };
}

interface Flash {
  x: number;
  y: number;
  t: number;
}
interface FingerState {
  sample: PointerSample;
  lastMove: number;
  /** for bare-gel gestures: when/where it landed, how far it has travelled, last rub grain */
  downAt: number;
  x0: number;
  y0: number;
  moved: number;
  lastRub: number;
  bareGel: boolean;
}

/**
 * Orchestrates gel + beads + pulls + collector and owns the frame loop.
 * Everything that *feels* like something is deliberately staggered by a few
 * tens of ms (see doPop) – simultaneous animation reads as weightless.
 */
export class Game extends Emitter<GameEvents> implements PadView {
  private ctx: CanvasRenderingContext2D;
  dpr = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = 0;
  time = 0;

  gel = new Gel();
  beads: Bead[] = [];
  collector = new Collector();
  private pulls = new Map<number, Pull>();
  private fiberPulls = new Map<number, FiberPull>();
  private fiberHintUntil = 0;
  private triedTactile = new Set<TactileKind>();
  private tactileKind?: TactileKind;
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
  private neck = new PullNeckRenderer();
  /** reused every frame for the contact-shadow quad corners (device px) */
  private shadowQuad: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  padCx = 0;
  padCy = 0;
  private firstPopDone = false;
  private freePulled = 0;
  /** pads */
  progressStore = new PadProgress();
  nextProvider: NextPadProvider = new DiscoveryProvider();
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
  private lastSocketRefresh = 0;
  /** Completion follows every flight and the existing collector sleep, not a POP timer. */
  private finishing = false;
  private finishQuiet = 0;
  /** Short, bounded closing gesture; never a reward or a timing gate. */
  private finaleT = -1;
  private finaleCharge = 0;
  private finalePull: Pull | null = null;
  private finaleNote = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private ro: ResizeObserver;
  /** `?perf=1` frame timing overlay (off otherwise) */
  readonly perf = new PerfProbe();
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
    // Safari also gets its native activation event, including when dragging
    // suppresses a synthetic click. This listener never handles game input.
    canvas.addEventListener("touchstart", this.unlockAudio, { passive: true, capture: true });
    canvas.addEventListener("touchend", this.unlockAudio, { passive: true, capture: true });
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
    // photo beads that arrive after the first paint re-render the base once (rare: they are awaited at boot)
    void preloadBeadAssets().then(() => {
      invalidateBeadSprites();
      this.gel.markDirty();
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.destroy();
    this.canvas.removeEventListener("touchstart", this.unlockAudio, true);
    this.canvas.removeEventListener("touchend", this.unlockAudio, true);
    sfx.cancelPending();
    this.glCanvas?.remove();
    this.perf.destroy();
  }

  // ─── layout ───────────────────────────────────────────────────
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    sfx.cancelPending();
    // A rotation cancels the gesture, not the already extracted length.
    for (const [id, pull] of this.fiberPulls) {
      if (pull.bead.state === "held") pull.bead.state = "embedded";
      this.fingers.delete(id);
    }
    this.fiberPulls.clear();
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
        if (b.slotR !== undefined) b.slotR *= k;
      }
      for (const s of this.gel.sockets) {
        s.x *= k;
        s.y *= k;
        s.r *= k;
      }
    }
    this.gel.markDirty();
  }

  get s() {
    return this.gel.R / REF_PAD_R;
  }
  /** where treasures fly to: the treasure-box button, top right */
  get treasureEntry() {
    return { x: this.w - 46, y: 96 };
  }

  private toLocal(x: number, y: number) {
    return { x: x - this.padCx, y: (y - this.padCy) / this.gel.tilt };
  }
  toCanvas(lx: number, ly: number) {
    return { x: lx + this.padCx, y: ly * this.gel.tilt + this.padCy };
  }

  // ─── public API ───────────────────────────────────────────────
  newPad(instant = false) {
    this.finishing = false;
    this.finishQuiet = 0;
    this.finaleT = -1;
    this.finaleCharge = 0;
    this.finalePull = null;
    this.finaleNote = 0;
    this.scheduled = [];
    for (const p of this.pulls.values()) this.releaseBead(p.bead);
    this.pulls.clear();
    this.fiberPulls.clear();
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
          edgeInset: preset.edgeInset,
          smallFillZones: preset.smallFillZones,
          ...roundBeadBudget(preset, this.progressStore.totalCompleted),
          // how layered this pad is – some pads are mostly one layer, some hide a second one
          // under half their beads; always denser toward the middle than at the rim
          deeperChance: 0.26 + rng.next() * 0.3,
          kingChance: preset.kingChance ?? 0.3,
          raritySkew: preset.raritySkew,
          typeSkew: preset.typeSkew,
          rareCenterChance: preset.rareCenterChance,
          hiddenObject: this.hiddenForThisPad(),
          ultraChance: ULTRA_SURFACE_CHANCE,
        });
    // Dedicated static QA builds expose direct demos; normal Pages/AIT builds
    // cannot bypass the first-round progression with a URL parameter.
    const query = import.meta.env.DEV || import.meta.env.MODE === "tactile-preview" ? new URLSearchParams(location.search) : undefined;
    const preview = query?.get("tactile");
    this.tactileKind = query?.has("fibers") ? "fiber"
      : preview === "chain" || preview === "rainbow" || preview === "charm" || preview === "peel" || preview === "swirl" || preview === "fiber" ? preview
      : roundTactile(this.progressStore.totalCompleted);
    if (!this.testBeads && this.tactileKind) {
      if (this.progressStore.totalCompleted === 0 && !preview && !query?.has("fibers")) {
        installOpeningTactiles(this.beads, this.gel.R, rng);
      } else if (!preview && !query?.has("fibers")) {
        installRoundTactiles(this.beads, this.gel.R, rng, this.tactileKind);
      } else installTactile(this.beads, this.gel.R, rng, this.tactileKind);
      this.fiberHintUntil = this.time + 10;
    }
    this.padTotal = this.beads.length;
    this.collector.preparePad(this.beads.filter(b => !treasureKind(b.type)));
    this.peekUntil = -1;
    this.gel.sockets = [];
    this.gel.dents = [];
    this.gel.fade = instant ? 1 : 0.15;
    this.threads = [];
    this.gel.markDirty();
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
      hidden: !!this.pendingHidden && this.pendingHidden !== NONE && !this.treasure.has(this.pendingHidden),
      collection: this.progressStore.mode === "COLLECTION",
    };
  }

  /** is the next pad a rare variant passing by? */
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
    this.finishing = false;
    for (const b of this.beads)
      if (b.state === "embedded" || b.state === "held") {
        b.state = "collected";
        if (treasureKind(b.type)) this.treasure.add(b.type.id);
      }
    this.pulls.clear();
    this.fiberPulls.clear();
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
      if (b.fiber || !this.canGrab(b)) continue;
      const p = beadPos(b);
      this.gel.warp(p.x, p.y, this.tmp);
      const c = this.toCanvas(this.tmp.x, this.tmp.y);
      const s = this.s;
      const deep = b.layer === 1 ? 1.25 : 1;
      out.push({ id: b.id, x: c.x, y: c.y, r: b.radius, type: b.type.id, layer: b.layer, hidden: !!b.hidden, t1: b.type.grip * s * deep, t2: b.type.grip * s * deep + b.type.pull * s * (b.layer === 1 ? 1.35 : 1) });
    }
    return out;
  }

  /** The actual touch target, including a partially extracted yarn end. */
  debugFibers() {
    return this.beads.filter(b => b.fiber && (b.state === "embedded" || b.state === "held")).map(b => {
      const f = b.fiber!, p = this.fiberLocal(b, f.tip), screen = this.toCanvas(p.x, p.y);
      return { id: b.id, kind: f.kind ?? "fiber", x: screen.x, y: screen.y, pulled: f.pulled, length: f.length, state: b.state, scale: this.s };
    });
  }

  private fiberLocal(b: Bead, p: FiberPoint) {
    const point = { x: b.rx + p.x * this.s, y: b.ry + p.y * this.s };
    this.gel.warp(point.x, point.y, point);
    return point;
  }

  /** count of beads still grabbable (surface + surfaced deeper) */
  private remainingCount() {
    let n = 0;
    for (const b of this.beads) if (b.state === "embedded" || b.state === "held") n++;
    return n;
  }

  // ─── input ────────────────────────────────────────────────────
  private canGrab(b: Bead) {
    if (b.state !== "embedded") return false;
    if (b.layer === 0) return true;
    // Leave the empty socket alone during the 420ms pause; accept a bead only
    // once it is at least halfway up. The depth spring itself is unchanged.
    return b.depth.target === 0 && b.depth.x <= 0.5 && !this.beads.some(
      (o) => o.slot === b.slot && o.layer === 0 && (o.state === "embedded" || o.state === "held"),
    );
  }

  private topBeadAt(lx: number, ly: number): Bead | null {
    let best: Bead | null = null;
    let bestD = Infinity;
    const tol = 9 * this.s;
    for (const b of this.beads) {
      if (!this.canGrab(b)) continue;
      if (b.fiber) {
        const end = this.fiberLocal(b, b.fiber.tip);
        let d = Math.hypot(end.x - lx, (end.y - ly) * this.gel.tilt);
        if (b.fiber.kind === "peel") {
          const centre = this.fiberLocal(b,{x:0,y:0});
          const dc = Math.hypot(centre.x-lx,(centre.y-ly)*this.gel.tilt);
          if (dc < b.radius) d = Math.min(d,dc);
        }
        if (d < 22 && d < bestD) { bestD = d; best = b; }
        continue;
      }
      const p = beadPos(b);
      this.gel.warp(p.x, p.y, this.tmp);
      const foot = embeddedScale(b) * (b.type.shape === "oval" ? b.radius * (b.type.aspect ?? 1.7) * 0.78 : b.radius);
      const dy = clamp(b.depth.x, 0, 1) * b.radius * 0.22 - b.lift * 3 * this.s;
      // accept the bead where it is drawn *or* where it rests – the gel may still be ringing from a pop
      const d = Math.min(Math.hypot(this.tmp.x - lx, this.tmp.y + dy - ly), Math.hypot(p.x - lx, p.y + dy - ly));
      if (d < foot + tol && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private unlockAudio = () => sfx.unlock();

  private onDown = (p: PointerSample) => {
    sfx.beginGesture(p.id);
    const l = this.toLocal(p.x, p.y);
    const b = this.topBeadAt(l.x, l.y);
    if (!this.gel.inside(l.x, l.y) && !b) return;
    this.fingers.set(p.id, { sample: p, lastMove: performance.now(), downAt: performance.now(), x0: p.x, y0: p.y, moved: 0, lastRub: 0, bareGel: !b });
    if (!b?.fiber) this.gel.fingerDown(p.id, l.x, l.y);
    sfx.press();
    haptics.press();
    if (b) {
      b.state = "held";
      if (b.fiber) {
        if(!revealsBead(b.fiber)) this.triedTactile.add(b.fiber.kind ?? "fiber");
        else this.fiberHintUntil = this.time + 6;
        this.fiberPulls.set(p.id, new FiberPull(b, (l.x - b.rx) / this.s, (l.y - b.ry) / this.s));
        return;
      }
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
    const now = performance.now();
    f.lastMove = now;
    f.moved = Math.max(f.moved, Math.hypot(p.x - f.x0, p.y - f.y0));
    const l = this.toLocal(p.x, p.y);
    if (this.fiberPulls.has(p.id)) { this.advanceFiber(p); return; }
    this.gel.fingerMove(p.id, l.x, l.y);
    // rubbing bare gel: a soft grain every ~90ms while the finger really moves
    if (!this.pulls.has(p.id) && this.gel.inside(l.x, l.y) && p.speed > 220 && now - f.lastRub > 90) {
      f.lastRub = now;
      sfx.rub(p.speed);
    }
  };

  private onUp = (p: PointerSample, cancelled = false) => {
    if (!cancelled && this.fiberPulls.has(p.id)) this.advanceFiber(p);
    sfx.endGesture(p.id, cancelled);
    const f = this.fingers.get(p.id);
    this.fingers.delete(p.id);
    this.gel.fingerUp(p.id);
    const fiberPull = this.fiberPulls.get(p.id);
    if (fiberPull) {
      this.fiberPulls.delete(p.id);
      fiberPull.bead.state = "embedded";
      return;
    }
    const pull = this.pulls.get(p.id);
    if (pull) {
      this.pulls.delete(p.id);
      this.releaseBead(pull.bead, pull);
    } else if (!cancelled && f?.bareGel && performance.now() - f.downAt < 220 && f.moved < 8) {
      // a quick tap on bare gel
      sfx.tap();
    }
  };

  private advanceFiber(sample: PointerSample) {
    const pull = this.fiberPulls.get(sample.id);
    if (!pull) return;
    const b = pull.bead, f = b.fiber!, local = this.toLocal(sample.x, sample.y);
    const complete = pull.move((local.x - b.rx) / this.s, (local.y - b.ry) / this.s);
    if(f.kind === "peel" && f.pulled > f.length*.14) this.triedTactile.add("peel");
    if (f.kind === "peel") {
      const stage = Math.min(2, Math.floor(f.pulled / f.length * 3));
      if (stage > (f.felt ?? 0)) {
        f.felt = stage;
        if (!complete) { sfx.tactileStep("peel",stage);haptics.tactileStep("peel"); }
      }
    }
    if (!f.kind) {
      const stage = Math.min(2, Math.floor(f.pulled / f.length * 3));
      if (stage > (f.felt ?? 0)) {
        f.felt = stage;
        if (!complete) { sfx.tactileStep("fiber", stage); haptics.tactileStep("fiber"); }
      }
    }
    if(f.kind === "swirl") {
      if(f.pulled>f.length*.1)this.triedTactile.add("swirl");
      const stage=Math.floor(f.pulled/f.length*5);
      if(stage>(f.felt??0)) { f.felt=stage;if(!complete){sfx.tactileStep("swirl",stage);haptics.tactileStep("swirl");} }
    }
    if (isChain(f)) {
      const step = Array.from({length:chainCount(f)-1},(_,i)=>chainFraction(f,i+1)).filter(v=>f.pulled/f.length>=v).length;
      if (step > (f.felt ?? 0)) {
        f.felt = step;
        // One feedback event per input sample, even on a very fast swipe.
        // Nothing is queued after releasing or leaving the pad.
        if (!complete) { sfx.tactileStep(f.kind ?? "chain", step);haptics.tactileStep(f.kind ?? "chain"); }
        const root=fiberPoint(f);
        this.gel.shock(b.rx+root.x*this.s,b.ry+root.y*this.s,6*this.s,(f.kind === "charm" ? 2.7 : 2.1)*this.s);
      }
    }
    if (complete) {
      const tip = this.fiberLocal(b, f.tip);
      f.released = exposedFiber(f).map(p => {
        const point = this.fiberLocal(b, p);
        return { x: (point.x - tip.x) / this.s, y: (point.y - tip.y) * this.gel.tilt / this.s };
      });
      const root = fiberPoint(f), dx = f.tip.x - root.x, dy = f.tip.y - root.y, d = Math.hypot(dx, dy) || 1;
      this.doPop(b, sample.id, dx / d, dy / d, sample.speed);
    }
  }

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
        case "strain":
          // grip nearly maxed: the gel creaks softly before anything moves
          sfx.creak(b.type.mass, 0.1);
          break;
        case "jamStart":
          sfx.creak(b.type.mass, 0.3);
          haptics.jam();
          pull.creakT = 0;
          break;
        case "jamFree": {
          // the wedge gives: the bead lurches toward the finger, the gel around the socket shudders
          sfx.give(b.type.mass);
          haptics.give();
          b.off.impulse(pull.dirX * 28 * this.s, pull.dirY * 28 * this.s);
          this.gel.shock(b.rx, b.ry, b.radius, 1.6 * this.s);
          break;
        }
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
          this.gel.addDent(b.rx, b.ry, b.radius * 0.92, 0.6, b.type, b.rot);
          b.fakedOut = true;
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
    const sizeStrength = pullSizeStrength(b, this.gel.R);
    const king = b.type.id === "king";
    const rare = b.type.rarity === "rare";
    // Start at the last rendered (warped) centre, not the unwarped rest point.
    // Otherwise a strongly stretched king jumps backwards on its POP frame.
    const peeled = revealsBead(b.fiber);
    const pos = peeled ? this.fiberLocal(b,{x:0,y:0}) : b.fiber ? this.fiberLocal(b, b.fiber.tip) : embeddedPosition(b, this.gel, this.s);
    const releaseScale = peeled ? .76 : b.fiber ? 1 : embeddedScale(b);
    this.pulls.delete(fingerId);
    this.fiberPulls.delete(fingerId);
    this.gel.reanchor(fingerId);
    b.state = "flying";
    b.lift = 1;
    const lastInPad = this.remainingCount() === 0;

    // 0ms: freed – kicks toward the finger, hangs there ~150ms so the moment lands, then arcs into the cup
    // (treasures arc up to the treasure box instead)
    const kick = b.fiber ? (b.fiber.kind === "charm" ? 17 : 9) * s : b.type.bounce * s * (1 + Math.min(speed, 1400) / 2800) * (king ? 1.65 : 1);
    let kx = dx * kick;
    let ky = king ? Math.min(dy * kick, -kick * 0.25) - 12 * s : dy * kick;
    const start = this.toCanvas(pos.x + kx, pos.y + ky);
    if (king) {
      const margin = b.radius * 1.25;
      start.x = clamp(start.x, margin, this.w - margin);
      start.y = clamp(start.y, margin, this.h - margin);
      kx = start.x - this.padCx - pos.x;
      ky = (start.y - this.padCy) / this.gel.tilt - pos.y;
    }
    const kind = treasureKind(b.type);
    const end = kind ? this.treasureEntry : this.collector.entry;
    const mx = (start.x + end.x) / 2 + dx * 30 * s;
    const my = Math.max(b.radius * 1.25, Math.min(start.y, end.y) - (70 + 60 * Math.random() + (king ? 40 : 0)) * s);
    const dur = (king ? 0.48 : 0.46 + b.type.mass * 0.11) * (0.92 + Math.random() * 0.16);
    const hang = b.fiber ? 0.2 : king ? 0.15 : 0.12 + b.type.mass * 0.03;
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
      kx,
      ky,
      px: pos.x,
      py: pos.y,
      spin: (Math.random() - 0.5) * 9,
      releaseScale,
    };

    // t = 0: sound + haptic land exactly with the release
    if (b.fiber && !peeled) {
      sfx.tactileRelease(b.fiber.kind ?? "fiber", b.type.mass);
    }
    else sfx.pop(b.type.sound, b.type.mass, rare || !!kind, king ? 1.3 : 1);
    if (kind) this.schedule(0.05, () => haptics.rare());
    else if (b.fiber) haptics.tactilePop(b.fiber.kind ?? "fiber");
    else haptics.pop(b.type.mass);
    if (kind === "ultra") this.schedule(0.12, () => sfx.chime(true));

    // the socket is empty from now on
    const deeper = this.beads.find((o) => o.slot === b.slot && o.layer === 1 && o.state === "embedded" && o !== b);
    if (!deeper && (!b.fiber || peeled)) {
      // the hole is the slot's, not the object's: a buried treasure bigger than the bead
      // that sat on it was squeezed out through that bead's hole, so it never overlaps neighbours
      const host = this.beads.find((o) => o.slot === b.slot && o.layer === 0);
      const slotR = host && host !== b ? host.radius * 1.12 : Infinity;
      const sr = Math.min(b.radius, slotR) * 0.92;
      this.gel.sockets.push({ x: b.rx, y: b.ry, r: sr, type: b.type, rot: b.rot, k: 0.9 + rng.next() * 0.45, t: this.time });
      // Freshness is shaded once in the base socket. A separate unwarped
      // dent copy drifted over the mesh and made non-round holes look doubled.
    }
    if (b.type.rarity === "special") this.treasure.noteSpecial(b.type.id);
    this.gel.markDirty();

    // Visual only: does not postpone POP, input, or the flight into the jar.
    if (!b.fiber) this.threads.push({ hx: b.rx, hy: b.ry, bead: b, t: 0, life: 0.19 + sizeStrength * 0.045, side: Math.random() < 0.5 ? -1 : 1 });
    // +30ms: gel snaps back the other way, dent appears
    this.schedule(0.03, () => {
      const m = Math.pow(b.type.mass, 0.6);
      const tactileRecoil = b.fiber?.kind === "charm" ? .8 : b.fiber ? .6 : 1;
      const strength = (lastInPad ? 1.22 : 1) * (1 + sizeStrength * 0.18) * (king ? 1.3 : 1) * tactileRecoil;
      this.gel.recoil(-dx * 95 * s * m * strength, -dy * 95 * s * m * strength);
    });
    // +40ms: the gel around the hole bulges outward and rings down – neighbours ride it
    this.schedule(0.04, () => this.gel.shock(b.rx, b.ry, b.radius * (1 + sizeStrength * 0.16), 5 * s * Math.pow(b.type.mass, 0.5) * (1 + sizeStrength * 0.3) * (b.fiber?.kind === "charm" ? .8 : b.fiber ? .6 : 1)));
    // the bead underneath waits at the bottom of the hole, then rises (slow spring, no overshoot)
    if (deeper) this.schedule(0.42, () => (deeper.depth.target = 0));

    if (kind) this.flashes.push({ x: pos.x, y: pos.y, t: 0 });

    this.freePulled++;
    this.emit("pop", { bead: b, rare, pulled: this.freePulled });
    if (!this.firstPopDone) {
      this.firstPopDone = true;
      this.emit("firstPop", undefined);
    }
    this.emitProgress();

    if (lastInPad) {
      // Keep the release readable as one recoil, then let the final flight and
      // jar settle before the completion cue. Persist now even if the tab closes.
      this.finishing = true;
      this.finishQuiet = 0;
      this.progressStore.complete();
    }
  }

  private schedule(delay: number, fn: () => void) {
    this.scheduled.push({ at: this.time + delay, fn });
  }

  // ─── loop ─────────────────────────────────────────────────────
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.perf.begin(now);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05; // tab switch etc.
    this.update(dt);
    this.render();
    this.perf.end();
  };

  private update(dt: number) {
    this.time += dt;
    if (this.scheduled.length) {
      // compact in place; only allocate on the rare frames where something is due
      const list = this.scheduled;
      let due: (() => void)[] | null = null;
      let keep = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.at <= this.time) (due ??= []).push(e.fn);
        else list[keep++] = e;
      }
      list.length = keep;
      if (due) for (const fn of due) fn();
    }

    // young sockets are still settling: refresh the base a few times a second while any is under 12s
    if (this.time - this.lastSocketRefresh > 0.4 && this.gel.sockets.some((s) => this.time - (s.t ?? -99) < 12)) {
      this.lastSocketRefresh = this.time;
      this.gel.markDirty();
    }
    // held beads pull the gel around them
    this.gel.pulls.length = 0;
    for (const p of this.pulls.values()) {
      const b = p.bead;
      this.gel.pulls.push({ hx: b.rx, hy: b.ry, sx: p.stretch.x + b.off.x * 0.5, sy: p.stretch.y + b.off.y * 0.5, r: b.radius });
    }
    for (const p of this.fiberPulls.values()) {
      const b = p.bead, f = b.fiber!, root = fiberPoint(f);
      const dx = f.tip.x - root.x, dy = f.tip.y - root.y, d = Math.hypot(dx, dy) || 1;
      this.gel.pulls.push({ hx: b.rx + root.x * this.s, hy: b.ry + root.y * this.s,
        sx: dx / d * Math.min(d, 10) * this.s, sy: dy / d * Math.min(d, 10) * this.s, r: 5 * this.s });
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
    const finalPull = this.remainingCount() === 1 ? this.pulls.values().next().value ?? null : null;
    if (finalPull !== this.finalePull) {
      this.finalePull = finalPull;
      this.finaleNote = 0;
    }
    const charge = finalPull ? finalPull.tension * 0.25 + finalPull.progress * 0.75 : 0;
    this.finaleCharge += (charge - this.finaleCharge) * (1 - Math.exp(-dt * 12));
    const note = Math.floor(charge * 3.2);
    if (finalPull && note > this.finaleNote) {
      this.finaleNote = note;
      sfx.finishCharge(note);
    }
    // a pull only ever removes itself while handling its events, which Map iteration allows
    for (const [id, pull] of this.pulls) {
      const f = this.fingers.get(id);
      if (!f) continue;
      const l = this.toLocal(f.sample.x, f.sample.y);
      const speed = now - f.lastMove > 70 ? 0 : f.sample.speed;
      const events = pull.update(l.x, l.y, speed, dt);
      if (events.length) this.handlePullEvents(pull, id, events);
      // wedged: creak grains, closer together and sharper the harder the finger strains
      if (pull.jammed && this.pulls.has(id)) {
        pull.creakT += dt;
        if (pull.creakT > 0.11 - pull.over * 0.04) {
          pull.creakT = 0;
          sfx.creak(pull.bead.type.mass, 0.25 + pull.over * 0.75);
        }
      }
    }

    // beads
    for (const b of this.beads) {
      if (b.fiber && b.state === "embedded") relaxFiber(b.fiber, dt);
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
            if (!b.fiber || revealsBead(b.fiber) || isChain(b.fiber)) sfx.land(b.type.id === "king" ? "glass" : b.type.material, b.type.mass);
          }
          b.fly = undefined;
        }
      }
    }

    this.collector.step(dt);

    if (this.finishing) {
      const arrived = !this.beads.some((b) => b.state === "flying");
      this.finishQuiet = arrived && this.collector.settled ? this.finishQuiet + dt : 0;
      if (this.finishQuiet >= 0.12) {
        this.finishing = false;
        this.finaleT = 0;
        if (!this.reducedMotion) this.gel.recoil(0, 18 * this.s);
        sfx.done();
        this.emit("padEmpty", undefined);
      }
    }
    if (this.finaleT >= 0) {
      this.finaleT += dt;
      if (this.finaleT > FINALE_DURATION) this.finaleT = -1;
    }

    for (let i = this.threads.length - 1; i >= 0; i--) {
      const th = this.threads[i];
      th.t += dt;
      if (th.t >= th.life || th.bead.state !== "flying") this.threads.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].t += dt;
      if (this.flashes[i].t > 0.55) this.flashes.splice(i, 1);
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
      // corners tl, tr, bl, br; map() reuses one point – copy right away
      const c = this.shadowQuad;
      for (let i = 0; i < 4; i++) {
        const q = map(sx + R * (i & 1 ? 1.25 : -1.25), sy + R * (i & 2 ? 1.2 : -1.2));
        c[i * 2] = q.x;
        c[i * 2 + 1] = q.y;
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
    ctx.save();ctx.globalAlpha = gel.fade;
    for (const b of this.beads) {
      if (!b.fiber) continue;
      const removed = b.state !== "embedded" && b.state !== "held";
      if (b.fiber.kind === "peel") {
        if (!removed) drawPeel(ctx,b,p=>this.fiberLocal(b,p),this.s,dpr);
      } else if (b.fiber.kind === "swirl") {
        if (!removed) drawSwirl(ctx,b,p=>this.fiberLocal(b,p),this.s,dpr);
      } else if (isChain(b.fiber)) {
        drawChain(ctx,b,p=>this.fiberLocal(b,p),this.s,dpr,removed);
      } else drawFiber(ctx, b.fiber, p => this.fiberLocal(b, p), this.s, b.state === "held", removed, gel.col(.9, .12));
    }
    ctx.restore();
    // beads being pulled: hole + neck + the bead lifting out
    for (const p of this.pulls.values()) {
      const nb = p.bead;
      if (p.tension >= 0.02) {
        const fit = beadFit(nb);
        const r = nb.radius * (fit + (1 - fit) * nb.lift);
        this.neck.draw(ctx, { gel, bead: nb, pull: p, r, centre: embeddedPosition(nb, this.gel, this.s), s: this.s, dpr });
      }
      this.drawEmbedded(ctx, p.bead, true);
      if (p === this.finalePull && this.finaleCharge > 0.1) {
        const b = p.bead;
        this.gel.warp(b.rx + b.off.x, b.ry + b.off.y, this.tmp);
        const q = this.finaleCharge;
        drawFinishStar(ctx, this.tmp.x - b.radius * 1.2, this.tmp.y - b.radius * 0.6, (1.5 + q * 3) * this.s, q * 0.75);
        drawFinishStar(ctx, this.tmp.x + b.radius * 1.05, this.tmp.y + b.radius * 0.35, (1 + q * 2.2) * this.s, q * 0.55);
      }
    }
    for (const th of this.threads) drawThread(ctx, th, this);
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
    drawPadFinale(ctx, this.finaleT, gel.R, this.s, this.reducedMotion);
    ctx.restore();

    for (const b of this.beads) if (b.state === "flying" && b.fly) drawFlying(ctx, b, this, this.reducedMotion);
    this.collector.draw(ctx, dpr);
    drawJarFinale(ctx, this.finaleT, this.collector, this.reducedMotion);
    if (this.tactileKind && !this.triedTactile.has(this.tactileKind) && this.time < this.fiberHintUntil && this.beads.some(b => b.fiber)) {
      ctx.save();ctx.font = "500 13px sans-serif";ctx.textAlign = "center";ctx.fillStyle = "#8b778e";
      ctx.fillText(tactileHint[this.tactileKind], this.w / 2, this.padCy + gel.R * gel.tilt * 1.18 + 24);ctx.restore();
    }
  }

  /** everything embedded in the gel, at rest positions (the mesh does the moving) */
  private drawBaseBeads(ctx: CanvasRenderingContext2D) {
    const gel = this.gel;
    // a hole is sharpest when fresh and settles to 10% more residual depth than before – the gel
    // relaxes, the pad stops looking perforated
    for (const s of gel.sockets) {
      const age = this.time - (s.t ?? -99);
      const healing = 0.385 + 0.615 * Math.exp(-age / 3.5);
      const fresh = 1 + 0.12 * Math.exp(-age / 0.8);
      gel.drawSocket(ctx, s.x, s.y, s.r, s.type, s.rot, (s.k ?? 1) * healing * fresh);
    }
    const covered = new Set<number>();
    for (const b of this.beads) if (b.layer === 0 && (b.state === "embedded" || b.state === "held")) covered.add(b.slot);
    for (let layer = 1 as 0 | 1; layer >= 0; layer = (layer - 1) as 0 | 1) {
      for (const b of this.beads) {
        if (b.layer !== layer) continue;
        if (b.fiber) continue;
        if (b.state === "held") {
          // The moving opening is drawn once by the neck renderer, in the same warped
          // space as the bead. A second baked socket darkened / doubled it.
          continue;
        }
        if (b.state !== "embedded") continue;
        if (layer === 1 && !covered.has(b.slot) && b.depth.x > 0.02) {
          // the hole is empty for a beat: draw the cup, the bead rises out of it
          const host = this.beads.find((o) => o.slot === b.slot && o.layer === 0);
          const hr = host ? host.radius : b.radius;
          ctx.globalAlpha = clamp(b.depth.x, 0, 1);
          gel.drawSocket(ctx, b.rx, b.ry, hr * 0.92, host?.type, host?.rot ?? 0, 1.1);
          ctx.globalAlpha = 1;
        }
        if (layer === 1 && covered.has(b.slot)) {
          // A buried large bead must not bleed around or through its host. It is
          // shown only during the explicit short peek; otherwise the host fully
          // occludes it until that bead is popped.
          if (b.hidden && this.time < this.peekUntil) {
            ctx.globalAlpha = 0.82 * (this.pad.hiddenVisibility ?? 1);
            this.drawEmbedded(ctx, b, false, true, true);
            ctx.globalAlpha = 1;
          }
          continue;
        }
        this.drawEmbedded(ctx, b, false, true);
      }
    }
  }

  private drawEmbedded(ctx: CanvasRenderingContext2D, b: Bead, above = false, base = false, peek = false) {
    drawEmbeddedBead(ctx, b, this, this.time, above, base, peek);
  }
}

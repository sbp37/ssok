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
import { clamp, easeOutCubic, rng } from "./util/math";
import { Emitter } from "./util/Emitter";
import { PerfProbe } from "./util/PerfProbe";
import { RELEASE } from "./release";
import { PullNeckRenderer } from "./render/PullNeck";
import { drawFlying, drawThread, flyPos, type PadView, type Thread } from "./render/Flight";
import { beadFit, drawEmbeddedBead, embeddedPosition, embeddedScale } from "./render/EmbeddedBead";
import { drawFinishStar, drawJarFinale, drawPadFinale, FINALE_DURATION } from "./render/Finale";
import { PADS, padById, resolvePad, type PadType } from "./pads/PadTypes";
import { DiscoveryProvider, PadProgress, isRareVariant, today, type NextPadProvider } from "./pads/progress";
import { DailyStore, dailyPad } from "./rewards/daily";
import { BraceletStore } from "./rewards/bracelets";
import { BONUS_BUDGET, roundBeadBudget } from "./pads/pacing";
import { MAGNET_CHARGE, magnetAllowed, magnetOrder } from "./pads/magnet";
import { FIRST_TREASURE_GUARANTEE, HIDDEN_POOLS, NONE, ULTRA_SURFACE_CHANCE, VARIANT_PERKS, hiddenWeight, missingBoost, rainbowPool } from "./rewards/rates";
import { HIDDEN_TYPES, ULTRA_TYPES } from "./beads/BeadTypes";
import { TreasureStore, treasureKind, type FindResult, type TreasureKind } from "./rewards/treasure";
import { JarAlbum } from "./rewards/album";
import { themeOfPad } from "./rewards/themes";
import { colorKey, tinted } from "./pads/colors";
import type { BeadType } from "./beads/BeadTypes";
import { TactileController, type TactileHost } from "./fibers/TactileController";
import { roundTactile, tactileName } from "./fibers/Tactile";

export interface GameEvents {
  pop: { bead: Bead; rare: boolean; pulled: number };
  firstPop: undefined;
  padEmpty: undefined;
  slipped: undefined;
  /** how much of the current pad has been emptied */
  progress: { emptied: number; remaining: number; total: number };
  padChange: { pad: PadType; newPad: boolean; newVariant: boolean; bonus?: boolean; daily?: boolean };
  /** the calendar day turned while the game stayed open (checked when a pad opens) */
  newDay: undefined;
  /** the round's one-line how-to for its featured material (null = hide) */
  tactileHint: { text: string | null };
  /** a rare bead / hidden object / ultra landed in the treasure box */
  treasure: {
    type: BeadType; kind: TreasureKind; isNew: boolean; count: number; padName: string;
    /** the pinned treasure was found */ targetHit: boolean;
    /** a collection set just completed */ setDone?: string;
    /** the first find went straight onto the shelf */ shelved: boolean;
  };
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
export class Game extends Emitter<GameEvents> implements PadView, TactileHost {
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
  /** treasures already saved at their POP → what the find meant (for the landing toast) */
  private creditedNew = new Map<Bead, FindResult>();
  /** a first-time treasure came out of the pad on the table */
  private foundNewThisPad = false;
  /** yarn, strands, swirl, film: everything that is not an ordinary bead pull */
  private tactile = new TactileController(this, (b, id, dx, dy, speed) => this.doPop(b, id, dx, dy, speed));
  private hint: string | null = null;
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
  /** every emptied pad's jar, for the collection's album */
  album = new JarAlbum();
  /** today's gel, the stamp card and plant tickets */
  daily = new DailyStore(today(), this.progressStore.totalCompleted === 0);
  /** the bead box and the bracelets strung from it (a first start is seeded from the jar album) */
  bracelets = new BraceletStore(
    () => this.album.latest.flatMap((jar) => jar.beads),
    (id) => this.treasure.count(id),
  );
  /** the pad after this one – rolled once (and saved) so NEXT, the door and a restart all agree */
  private pendingNext: PadType | null = null;
  /** what that next pad hides (null = nothing), rolled together with it */
  private pendingHidden: string | null | undefined = undefined;
  /** treasure to use for the pad being generated right now, when it was pre-rolled */
  private startHidden: string | null | undefined = undefined;
  /** while > time, the buried object is shown clearly (the "살짝 보기" hint) */
  private peekUntil = -1;
  /** the pad on the table is a small bonus dig: not a completion, not a progress step */
  private bonusRound = false;
  /** the pad on the table is today's gel */
  private dailyRound = false;
  /** this start itself opened today's gel (for the "opened" count – a restart mid-pad is not an opening) */
  bootOpenedDaily = false;
  /** this start counted as today's visit: the attendance streak, and whether it was the day's first */
  bootVisit = { streak: 0, first: false };
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
  /** "자석 싹쓸이" is taking the rest of this pad: no new grabs until it is done */
  private sweeping = false;
  /** when the magnet took hold, and when its last bead landed (game time; -1 = not yet) */
  private magnetAt = -1;
  private magnetEnd = -1;
  /** beads the magnet is carrying – a glitter trail follows each */
  private magnetized = new Set<Bead>();
  /** small star bursts where the magnet freed a bead (canvas px) */
  private bursts: { x: number; y: number; t: number; turn: number }[] = [];
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private ro: ResizeObserver;
  /** `?perf=1` frame timing overlay (off otherwise) */
  readonly perf = new PerfProbe();
  private tmp = { x: 0, y: 0 };
  /** `?test=5` → sparse 5-bead pad for tuning the hand-feel (never in a release bundle) */
  private testBeads = (() => {
    const v = RELEASE ? null : new URLSearchParams(location.search).get("test");
    return v ? Math.max(1, parseInt(v, 10) || 5) : 0;
  })();

  constructor(private canvas: HTMLCanvasElement) {
    super();
    // today's attendance first: a streak's rainbow day decides what today's gel looks like
    this.bootVisit = this.daily.visit(today());
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    // gel layer: a WebGL canvas slipped under the 2D one (same size, pointer-events off)
    const glc = document.createElement("canvas");
    glc.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    canvas.parentElement?.insertBefore(glc, canvas);
    this.gl = MeshGL.create(glc);
    if (this.gl) {
      this.glCanvas = glc;
      this.gl.setGrid(this.gel.gridN);
      // the GPU can drop the context (memory pressure, a long stay in the background behind an ad):
      // draw the 2D gel meanwhile instead of an empty pad, and rebuild the renderer when it returns
      glc.addEventListener("webglcontextlost", this.onGlLost);
      glc.addEventListener("webglcontextrestored", this.onGlRestored);
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
    const forced = RELEASE ? undefined : padById(new URLSearchParams(location.search).get("pad") ?? "");
    let pad = forced;
    if (!pad) {
      const prog = this.progressStore;
      if (prog.currentDone && prog.bonusTreasure) {
        // a bonus dig was paid for (its ad's reward event came) and its treasure is still buried
        pad = prog.current;
        this.bonusRound = true;
        this.startHidden = prog.bonusTreasure;
      } else if (prog.currentDone) {
        // emptied last time but never walked through the door → continue at the next pad, not the same one
        pad = (prog.nextId ? resolvePad(prog.nextId) : undefined) ?? this.nextProvider.next(prog);
        // a passing variant is only caught through its rewarded door – a restart opens the plain pad,
        // unless that door's ad had already paid out when the app closed
        const passing = !!pad.variantOf && !prog.nextCaught;
        if (passing) pad = padById(pad.variantOf!) ?? pad;
        // the variant's guaranteed treasure stays with the variant: the plain pad rolls its own
        this.startHidden = prog.nextId && !passing ? prog.nextHidden : undefined;
        // the first pad of a new day is today's gel (a caught variant goes first); a treasure
        // already bound to the next pad – one planted through an ad – goes with it
        if (!pad.variantOf && this.dailyDue()) {
          pad = this.dayGel(today());
          this.startHidden = this.dayGelHidden(pad, this.startHidden);
        }
        prog.open(pad);
        this.dailyRound = pad.daily === today();
        if (this.dailyRound) {
          this.daily.openedDaily(today());
          this.bootOpenedDaily = true;
        }
      } else {
        // mid-pad exit → same pad, fresh beads, the same buried treasure (a planted one included);
        // a gel of the day comes back with its own colour
        pad = prog.current;
        const daily = prog.currentDaily ? dailyPad(prog.currentDaily, prog.currentRainbow) : undefined;
        if (daily && daily.id === pad.id) pad = daily;
        this.dailyRound = pad.daily === today();
        this.startHidden = prog.currentHidden;
        // very first start: the pad on the table counts as discovered too
        if (!prog.isDiscovered(pad.variantOf ?? pad.id)) prog.open(pad);
      }
    }
    // this opening's gel colour (a ?pad= QA start keeps the pad's own)
    if (!forced) pad = this.tint(pad);
    this.progressStore.noteColor(colorKey(pad.gelColor));
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

  private onGlLost = (e: Event) => {
    e.preventDefault(); // ask for the context back
    this.gl = null;
    this.gel.markDirty();
  };
  private onGlRestored = () => {
    const glc = this.glCanvas;
    if (!glc) return;
    const gl = MeshGL.create(glc);
    if (!gl) return;
    glc.width = this.canvas.width;
    glc.height = this.canvas.height;
    gl.resize(this.canvas.width, this.canvas.height);
    gl.setGrid(this.gel.gridN);
    // every texture was lost with the context
    this.glBaseVersion = -1;
    this.glShadowR = -1;
    this.gl = gl;
    this.gel.markDirty();
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.glCanvas?.removeEventListener("webglcontextlost", this.onGlLost);
    this.glCanvas?.removeEventListener("webglcontextrestored", this.onGlRestored);
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
    for (const id of this.tactile.cancelAll()) this.fingers.delete(id);
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
    this.sweeping = false;
    this.magnetAt = -1;
    this.magnetEnd = -1;
    this.magnetized.clear();
    this.bursts = [];
    this.scheduled = [];
    for (const p of this.pulls.values()) this.releaseBead(p.bead);
    this.pulls.clear();
    this.tactile.clear();
    const boundary = (th: number) => this.gel.boundary(th);
    const hole = this.gel.hasHole ? (th: number) => this.gel.holeAt(th) : undefined;
    const preset = this.pad.beads;
    // what this pad buries is decided once and saved: a restart mid-pad buries the same thing
    const hidden = this.testBeads ? undefined : this.hiddenForThisPad();
    if (!this.testBeads && !this.bonusRound) this.progressStore.setCurrentHidden(hidden ?? null);
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
      : this.bonusRound
        ? generatePad(this.gel.R, rng, {
            // a handful of beads around one sure treasure – a dig, not another round
            boundary,
            hole,
            edgeInset: preset.edgeInset,
            ...BONUS_BUDGET,
            deeperChance: 0.2,
            kingChance: 0,
            raritySkew: preset.raritySkew,
            typeSkew: preset.typeSkew,
            hiddenObject: hidden,
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
            hiddenObject: hidden,
            ultraChance: ULTRA_SURFACE_CHANCE,
          });
    this.tactile.install(this.progressStore.totalCompleted, rng, !!this.testBeads || this.bonusRound);
    this.padTotal = this.beads.length;
    this.collector.preparePad(this.beads.filter(b => !treasureKind(b.type)));
    this.peekUntil = -1;
    this.foundNewThisPad = false;
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
  private rollHidden(pad: PadType, dayBonus = false, forceTreasure = false, newFirst = false): string | null {
    const pool = HIDDEN_POOLS[pad.variantOf ?? pad.id];
    if (!pool?.length) return null;
    const perk = pad.tier ? VARIANT_PERKS[pad.tier].treasure : undefined;
    const guarantee = forceTreasure || perk !== undefined || this.progressStore.totalCompleted < FIRST_TREASURE_GUARANTEE;
    const ultraIds = ULTRA_TYPES.map((t) => t.id);
    const boost = (id: string) => missingBoost(id, { found: this.treasure.has(id), dry: this.treasure.dry, target: this.treasure.target, ultraIds });
    // a rainbow gel buries one never found before while its pad still hides one
    const from = newFirst ? rainbowPool(pool, (id) => this.treasure.has(id), ultraIds) : pool;
    const picked = rng.weighted(from, (e) => hiddenWeight(e, { guarantee, ultraOnly: perk === "ultra", dayBonus, ultraIds }) * boost(e.id));
    return picked.id === NONE ? null : picked.id;
  }

  /** the gel of `day`: a rainbow gel when that day is a streak's rainbow day */
  private dayGel(day: string) {
    return dailyPad(day, this.daily.rainbowOn(day));
  }
  /** what today's gel buries: a treasure already bound to the next pad goes with it (one planted
   * through an ad), except that a rainbow gel trades one already found for one never found */
  private dayGelHidden(pad: PadType, carried: string | null | undefined) {
    if (carried && !(pad.rainbow && this.treasure.has(carried))) return carried;
    return this.rollHidden(pad, true, true, !!pad.rainbow);
  }

  /** treasure for the pad being generated: the pre-rolled one if there is one, else a fresh roll */
  private hiddenForThisPad(): string | undefined {
    // a bonus dig has its sure treasure already – the day's nudge waits for the next real pad
    const day = !this.bonusRound && this.progressStore.takeDayBonus();
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
        this.pendingNext = this.tint(saved);
        this.pendingHidden = prog.nextHidden;
      } else {
        this.pendingNext = this.tint(this.nextProvider.next(prog));
        this.pendingHidden = this.rollHidden(this.pendingNext);
        prog.setNext(this.pendingNext, this.pendingHidden);
      }
      // the first pad of a new day is today's gel – a variant passing by goes first, and a
      // treasure already bound to the next pad goes with it; otherwise it buries one for sure
      if (!this.pendingNext.variantOf && !this.pendingNext.daily && this.dailyDue()) {
        const pad = this.dayGel(today());
        this.pendingHidden = this.dayGelHidden(pad, this.pendingHidden);
        this.pendingNext = pad;
        prog.setNext(pad, this.pendingHidden);
      }
    }
    return this.pendingNext;
  }

  /** did the pad on the table bury something (the "dig" door is for the pads that did not) */
  get hadTreasure() {
    return this.beads.some((b) => b.hidden && treasureKind(b.type));
  }
  get isBonus() {
    return this.bonusRound;
  }
  get isDaily() {
    return this.dailyRound;
  }
  /** the pad on the table is today's gel in rainbow silicone */
  get isRainbow() {
    return this.dailyRound && !!this.pad.rainbow;
  }
  /** today's gel waits: not opened yet today, and not a new player's first day or very first pad */
  private dailyDue() {
    // past midnight with the game still open, today is a visit before its gel is decided: a streak's
    // third day must not be handed yesterday's plain gel just because no pad has opened yet
    this.daily.visit(today());
    return this.progressStore.totalCompleted >= 1 && this.daily.dailyDue(today());
  }
  /** the sure treasure a bonus dig would bury now – shown on the "한 번 더 파기" door before the ad */
  rollBonusTreasure() {
    return this.rollHidden(this.pad, false, true);
  }

  /** "광고 보고 잡기" paid out: a restart before the door opens still lands on the variant */
  catchNext() {
    this.progressStore.catchNext();
  }
  /** "한 번 더 파기" paid out: its treasure is decided now, so a restart digs the same one */
  earnBonus(id?: string | null) {
    if (!this.progressStore.bonusTreasure) this.progressStore.setBonusTreasure(id || this.rollHidden(this.pad, false, true));
  }

  /** "광고 보고 심기": the next pad buries this treasure instead of whatever it rolled */
  plantNext(id: string) {
    const pad = this.nextPad;
    this.pendingHidden = id;
    this.progressStore.setNext(pad, id);
  }

  /** roll the next pad's treasure again with the current state (see the completion in doPop) */
  private rerollNextHidden() {
    const pad = this.nextPad;
    // today's gel always buries something (a rainbow gel something new, while there is anything new)
    this.pendingHidden = this.rollHidden(pad, !!pad.daily, !!pad.daily, !!pad.rainbow);
    this.progressStore.setNext(pad, this.pendingHidden);
  }

  /** "광고 보고 고르기": the next pad and two other pads, all distinct */
  nextChoices(): PadType[] {
    // shown in the colours they will open with
    const recent = [...this.progressStore.recentColors];
    return (this.nextProvider.choices?.(this.progressStore, this.nextPad, 2) ?? [this.nextPad]).map((p) => {
      const t = tinted(p, recent);
      recent.push(colorKey(t.gelColor)); // three different colours side by side
      return t;
    });
  }

  /** everything the NEXT tease is allowed to know */
  get nextInfo() {
    const pad = this.nextPad;
    const rare = isRareVariant(pad);
    return {
      pad,
      rare,
      tier: pad.tier,
      rareNew: rare && !this.progressStore.isVariantDiscovered(pad.id),
      ultra: !!this.pendingHidden && ULTRA_TYPES.some((t) => t.id === this.pendingHidden),
      hidden: !!this.pendingHidden && this.pendingHidden !== NONE && !this.treasure.has(this.pendingHidden),
      collection: this.progressStore.mode === "COLLECTION",
      tactile: this.nextTactileName,
      // the pinned treasure can hide in this pad (a promise of a chance, never of the thing)
      target: this.pinCanHideIn(pad),
      // one of this month's limited pads
      theme: themeOfPad(pad.id)?.name,
      themeId: themeOfPad(pad.id)?.id,
      // today's gel: a treasure for sure (a rainbow gel: a streak's reward)
      daily: pad.daily === today(),
      rainbow: pad.daily === today() && !!pad.rainbow,
    };
  }

  /** the next pad's featured material. Completion is counted at the last POP, so a
   * pad that is not yet done still has one completion to go. */
  private get nextTactileName() {
    const prog = this.progressStore;
    const kind = roundTactile(prog.totalCompleted + (prog.currentDone ? 0 : 1));
    return kind ? tactileName[kind] : undefined;
  }

  /** name of the pinned treasure if it is in this pad's pool */
  pinCanHideIn(pad: PadType): string | undefined {
    const id = this.treasure.target;
    if (!id) return undefined;
    if (!(HIDDEN_POOLS[pad.variantOf ?? pad.id] ?? []).some((e) => e.id === id)) return undefined;
    return HIDDEN_TYPES.find((t) => t.id === id)?.name;
  }

  /** is the next pad a rare variant passing by? */
  get nextIsRare() {
    return isRareVariant(this.nextPad);
  }

  /** the buried object of the current pad, and whether it has never been found before */
  get hiddenInfo() {
    const b = this.beads.find((x) => x.hidden && treasureKind(x.type) && (x.state === "embedded" || x.state === "held"));
    if (!b) return null;
    return { type: b.type, isNew: !this.treasure.has(b.type.id) };
  }

  /** show the buried object clearly for a moment (after "광고 보고 살짝 보기") */
  peekHidden(seconds = 1.8) {
    this.peekUntil = this.time + seconds;
    this.gel.markDirty();
    if (Number.isFinite(seconds)) this.schedule(seconds + 0.02, () => this.gel.markDirty());
  }

  /**
   * switch to a pad: reshape the gel, fresh beads. The jar holds *this pad's*
   * beads, so it is tidied away now – briefly, not wiped in one frame.
   */
  openPad(pad: PadType) {
    // past midnight with the game still open: this pad is the new day's first, with its nudge,
    // and the new day counts as a visit
    if (this.progressStore.rollDay()) {
      this.daily.visit(today());
      this.emit("newDay", undefined);
    }
    pad = this.tint(pad);
    this.progressStore.noteColor(colorKey(pad.gelColor));
    this.collector.dismiss();
    this.bonusRound = false;
    // the treasure rolled for NEXT travels with it; a different pad rolls fresh
    this.startHidden = this.pendingNext && this.pendingNext.id === pad.id ? this.pendingHidden : undefined;
    const { newPad, newVariant } = this.progressStore.open(pad);
    // yesterday's gel carried past midnight is just a pad: today's still waits
    this.dailyRound = pad.daily === today();
    if (this.dailyRound) this.daily.openedDaily(today());
    this.gel.setShape(pad);
    this.newPad();
    this.glShadowR = -1; // silhouette-shaped shadow changes even at the same R
    this.pendingNext = null;
    this.pendingHidden = undefined;
    this.emit("padChange", { pad, newPad, newVariant, daily: this.dailyRound });
    this.emitProgress();
  }

  /**
   * "광고 보고 한 번 더 파기": the same pad again, tiny, with one treasure for
   * sure. Progress is not touched – the pad stays "emptied", so this is neither
   * a completion (promotions, ad interval) nor a new pad (play counts, NEXT):
   * the rolled next pad still waits behind it. Only `bonusTreasure` is kept, so
   * a restart before its treasure is dug up digs the same one again.
   */
  openBonusPad() {
    this.collector.dismiss();
    this.earnBonus();
    this.bonusRound = true;
    this.dailyRound = false;
    this.startHidden = this.progressStore.bonusTreasure;
    this.gel.setShape(this.pad);
    this.newPad();
    this.glShadowR = -1;
    this.emit("padChange", { pad: this.pad, newPad: false, newVariant: false, bonus: true });
    this.emitProgress();
  }

  /** let a rare variant pass: open the plain version of that pad instead */
  openNextPlain() {
    const next = this.nextPad;
    // a plain next pad keeps the colour NEXT already showed; a passing variant's base gets its own
    this.openPad(next.variantOf ? padById(next.id)! : next);
  }

  /** a magnet already paid for on this pad (its ad's reward came, then the app closed before the pad emptied) */
  get magnetOwed() {
    return this.progressStore.magnetOwed;
  }
  /** the magnet's ad paid out: kept until this pad is emptied, so a restart owes it */
  earnMagnet() {
    this.progressStore.oweMagnet();
  }

  /** the magnet could take the rest of this pad now (pads/magnet.ts), and nothing else is already taking it */
  canMagnet() {
    if (this.testBeads || this.sweeping || this.finishing) return false;
    return magnetAllowed({ left: this.remainingCount(), completed: this.progressStore.totalCompleted, bonus: this.bonusRound });
  }

  /**
   * "자석 싹쓸이" (paid by a rewarded ad): every bead still in the pad lets go by itself and flies
   * to the jar – a treasure to its box – one after another, each through the ordinary POP, so finds
   * are credited and the last one completes the pad as usual. First a beat of charge (the ad has
   * just closed and the sound is coming back), then the beads on top, then the ones under them.
   */
  magnetSweep() {
    const left = this.beads.filter((b) => b.state === "embedded" || b.state === "held");
    if (this.sweeping || this.finishing || !left.length) return false;
    this.sweeping = true;
    // whatever a finger held lets go: the magnet has it now
    for (const id of this.tactile.cancelAll()) this.fingers.delete(id);
    for (const [id, p] of this.pulls) {
      p.bead.state = "embedded";
      p.bead.off.setTarget(0, 0);
      this.gel.reanchor(id);
    }
    this.pulls.clear();
    this.gel.markDirty();
    const toward = (b: Bead) => {
      const c = this.toCanvas(b.rx, b.ry);
      const end = treasureKind(b.type) ? this.treasureEntry : this.collector.entry;
      const d = Math.hypot(end.x - c.x, end.y - c.y) || 1;
      return { x: (end.x - c.x) / d, y: (end.y - c.y) / d, d };
    };
    this.schedule(0.12, () => {
      this.magnetAt = this.time;
      sfx.magnet();
      haptics.magnet();
    });
    // the charge: three tugs toward the jar, the gel shivering under every bead left
    for (const at of [0.16, 0.27, 0.38].filter((t) => t < MAGNET_CHARGE)) {
      this.schedule(at, () => {
        for (const b of left) {
          if (b.state !== "embedded") continue;
          const dir = toward(b);
          b.off.impulse(dir.x * 90 * this.s, (dir.y / this.gel.tilt) * 90 * this.s);
          b.lift = Math.max(b.lift, 0.5);
          this.gel.shock(b.rx, b.ry, b.radius, 1.2 * this.s);
        }
      });
    }
    // one at a time, each a note higher
    magnetOrder(left, (b) => toward(b).d).forEach(({ bead, at }, i) => this.schedule(at, () => this.magnetPop(bead, i)));
    return true;
  }

  private magnetPop(b: Bead, i: number) {
    if (b.state !== "embedded" && b.state !== "held") return;
    const pos = embeddedPosition(b, this.gel, this.s);
    const from = this.toCanvas(pos.x, pos.y);
    const end = treasureKind(b.type) ? this.treasureEntry : this.collector.entry;
    const d = Math.hypot(end.x - from.x, end.y - from.y) || 1;
    this.magnetized.add(b);
    this.bursts.push({ x: from.x, y: from.y, t: 0, turn: Math.random() * Math.PI });
    sfx.magnetNote(i);
    this.doPop(b, -1, (end.x - from.x) / d, (end.y - from.y) / d, 700, true);
  }

  /** the pad with this opening's gel colour, never one of the last few on the table */
  private tint(pad: PadType): PadType {
    return tinted(pad, this.progressStore.recentColors);
  }

  /** test/QA: empty the pad instantly (beads vanish, treasures are credited, completion logic runs) */
  debugFinishPad() {
    this.finishing = false;
    // what already landed in this pad's jar, plus everything emptied now
    const pulled: [string, string][] = this.collector.dismissing ? [] : this.collector.items.map((it) => [it.bead.type.id, it.bead.color]);
    for (const b of this.beads)
      if (b.state === "embedded" || b.state === "held") {
        b.state = "collected";
        pulled.push([b.type.id, b.color]);
        if (treasureKind(b.type)) this.treasure.add(b.type.id);
      }
    this.bracelets.addBeads(pulled);
    this.pulls.clear();
    this.tactile.clear();
    this.gel.markDirty();
    if (this.bonusRound) this.progressStore.setBonusTreasure(null);
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

  /**
   * Where to show the "stuck?" gesture hint: a featured material first (those
   * need a gesture of their own), otherwise any bead that can be pulled now.
   * Canvas CSS px, the same space as the UI overlay.
   */
  stuckHint(firstPull = false): { x: number; y: number; kind: "pull" | "swirl" | "peel" | "tap" | "yarn" | "chain" } | null {
    const grabbable = this.debugBeads().sort((p, q) => q.r - p.r);
    // plain beads first; a surfaced treasure only when nothing else is left
    const bead = grabbable.find((d) => !d.hidden) ?? grabbable[0];
    // a brand-new player first learns the plain pull on the biggest plain bead
    if (firstPull && bead) return { x: bead.x, y: bead.y, kind: "pull" };
    const fibers = this.tactile.debug((x, y) => this.toCanvas(x, y)).filter((f) => f.state === "embedded");
    if (fibers.length) {
      const f = fibers[0];
      const kind = f.kind === "swirl" ? "swirl" : f.kind === "peel" ? "peel" : f.kind === "bubble" ? (f.pulled >= f.length ? "pull" : "tap")
        : f.kind === "fiber" ? "yarn" : "chain";
      return { x: f.x, y: f.y, kind };
    }
    return bead ? { x: bead.x, y: bead.y, kind: "pull" } : null;
  }

  /** The actual touch targets, including a partially extracted yarn end. */
  debugFibers() {
    return this.tactile.debug((x, y) => this.toCanvas(x, y));
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
        const d = this.tactile.hitDistance(b, lx, ly);
        if (d < bestD) { bestD = d; best = b; }
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
    // while the magnet takes the last beads the gel still answers a touch, but nothing can be grabbed
    const b = this.sweeping ? null : this.topBeadAt(l.x, l.y);
    if (!this.gel.inside(l.x, l.y) && !b) return;
    this.fingers.set(p.id, { sample: p, lastMove: performance.now(), downAt: performance.now(), x0: p.x, y0: p.y, moved: 0, lastRub: 0, bareGel: !b });
    if (!b?.fiber || this.tactile.dimples(b)) this.gel.fingerDown(p.id, l.x, l.y);
    sfx.press();
    haptics.press();
    if (b) {
      if (b.fiber) {
        this.tactile.grab(p.id, b, l.x, l.y);
        return;
      }
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
    const now = performance.now();
    f.lastMove = now;
    f.moved = Math.max(f.moved, Math.hypot(p.x - f.x0, p.y - f.y0));
    const l = this.toLocal(p.x, p.y);
    if (this.tactile.holding(p.id)) {
      if (this.tactile.dimplesFinger(p.id)) this.gel.fingerMove(p.id, l.x, l.y);
      this.tactile.move(p, l.x, l.y);
      return;
    }
    this.gel.fingerMove(p.id, l.x, l.y);
    // rubbing bare gel: a soft grain every ~90ms while the finger really moves
    if (!this.pulls.has(p.id) && this.gel.inside(l.x, l.y) && p.speed > 220 && now - f.lastRub > 90) {
      f.lastRub = now;
      sfx.rub(p.speed);
    }
  };

  private onUp = (p: PointerSample, cancelled = false) => {
    if (!cancelled && this.tactile.holding(p.id)) {
      const l = this.toLocal(p.x, p.y);
      this.tactile.move(p, l.x, l.y);
      this.tactile.lift(p);
    }
    const held = this.pulls.get(p.id);
    if (!cancelled && held) {
      const l = this.toLocal(p.x, p.y);
      const events = held.update(l.x, l.y, p.speed, 0);
      if (events.length) this.handlePullEvents(held, p.id, events);
    }
    sfx.endGesture(p.id, cancelled);
    const f = this.fingers.get(p.id);
    this.fingers.delete(p.id);
    this.gel.fingerUp(p.id);
    if (this.tactile.release(p.id)) return;
    const pull = this.pulls.get(p.id);
    if (pull) {
      this.pulls.delete(p.id);
      this.releaseBead(pull.bead, pull);
    } else if (!cancelled && f?.bareGel && performance.now() - f.downAt < 220 && f.moved < 8) {
      // a quick tap on bare gel
      sfx.tap();
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
  private doPop(b: Bead, fingerId: number, dx: number, dy: number, speed: number, magnet = false) {
    const s = this.s;
    const sizeStrength = pullSizeStrength(b, this.gel.R);
    const king = b.type.id === "king";
    const rare = b.type.rarity === "rare";
    // Start at the last rendered (warped) centre, not the unwarped rest point.
    // Otherwise a strongly stretched king jumps backwards on its POP frame.
    const t = b.fiber ? this.tactile.popStyle(b) : null;
    const pos = t ? t.pos : embeddedPosition(b, this.gel, this.s);
    const releaseScale = t ? t.releaseScale : embeddedScale(b);
    this.pulls.delete(fingerId);
    this.gel.reanchor(fingerId);
    b.state = "flying";
    b.lift = 1;
    const lastInPad = this.remainingCount() === 0;

    // 0ms: freed – kicks toward the finger, hangs there ~150ms so the moment lands, then arcs into the cup
    // (treasures arc up to the treasure box instead)
    const kick = t ? t.kick * s : b.type.bounce * s * (1 + Math.min(speed, 1400) / 2800) * (king ? 1.65 : 1);
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
    // the magnet draws its beads straight in: a low arc, no hang, quicker
    const rise = magnet ? 26 + 30 * Math.random() : 70 + 60 * Math.random() + (king ? 40 : 0);
    const my = Math.max(b.radius * 1.25, Math.min(start.y, end.y) - rise * s);
    const dur = (magnet ? 0.36 + b.type.mass * 0.05 : king ? 0.48 : 0.46 + b.type.mass * 0.11) * (0.92 + Math.random() * 0.16);
    const hang = magnet ? 0.08 : t ? t.hang : king ? 0.15 : 0.12 + b.type.mass * 0.03;
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
    if (t?.releaseSound) sfx.tactileRelease(b.fiber!.kind ?? "fiber", b.type.mass);
    else sfx.pop(b.type.sound, b.type.mass, rare || !!kind, king ? 1.3 : 1);
    if (kind) this.schedule(0.05, () => haptics.rare());
    else if (b.fiber) haptics.tactilePop(b.fiber.kind ?? "fiber");
    else haptics.pop(b.type.mass);
    if (kind === "ultra") this.schedule(0.12, () => sfx.chime(true));

    // the socket is empty from now on
    const deeper = this.beads.find((o) => o.slot === b.slot && o.layer === 1 && o.state === "embedded" && o !== b);
    if (!deeper && (!t || t.socket)) {
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
    if (!t) this.threads.push({ hx: b.rx, hy: b.ry, bead: b, t: 0, life: 0.19 + sizeStrength * 0.045, side: Math.random() < 0.5 ? -1 : 1 });
    // +30ms: gel snaps back the other way, dent appears
    this.schedule(0.03, () => {
      const m = Math.pow(b.type.mass, 0.6);
      const strength = (lastInPad ? 1.22 : 1) * (1 + sizeStrength * 0.18) * (king ? 1.3 : 1) * (t?.recoil ?? 1);
      this.gel.recoil(-dx * 95 * s * m * strength, -dy * 95 * s * m * strength);
    });
    // +40ms: the gel around the hole bulges outward and rings down – neighbours ride it
    this.schedule(0.04, () => this.gel.shock(b.rx, b.ry, b.radius * (1 + sizeStrength * 0.16), 5 * s * Math.pow(b.type.mass, 0.5) * (1 + sizeStrength * 0.3) * (t?.recoil ?? 1)));
    // the bead underneath waits at the bottom of the hole, then rises (slow spring, no overshoot)
    if (deeper) this.schedule(0.42, () => (deeper.depth.target = 0));

    if (kind) {
      this.flashes.push({ x: pos.x, y: pos.y, t: 0 });
      // credit it now: closing the app mid-flight must not lose a find
      const found = this.treasure.add(b.type.id, this.bonusRound ? "보너스" : this.pad.name);
      if (found.isNew) this.foundNewThisPad = true;
      this.creditedNew.set(b, found);
      // dug up: a restart must not bury it again (one ad, one treasure)
      const prog = this.progressStore;
      if (b.hidden && this.bonusRound && b.type.id === prog.bonusTreasure) prog.setBonusTreasure(null);
      else if (b.hidden && !this.bonusRound && b.type.id === prog.currentHidden) prog.setCurrentHidden(null);
    }

    this.tactile.onPop();
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
      if (this.bonusRound) this.progressStore.setBonusTreasure(null);
      else {
        // a pad with no first-time find nudges the missing treasures up a little (bonus digs do not count)
        if (!this.foundNewThisPad) this.treasure.noteDryPad();
        // what the next pad hides is decided now, with this pad's finds, the pin and the catch-up
        // all counted. Hidden from view until here (NEXT names it only on the emptied pad), and
        // never touched again after – a pin set later counts from the pad after next.
        this.rerollNextHidden();
      }
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
    this.tactile.update(dt);

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
      if (b.state === "embedded" && b.lift > 0) b.lift = Math.max(0, b.lift - dt * 5);
      if (b.state === "flying" && b.fly) {
        const f = b.fly;
        f.t += dt;
        if (f.t >= f.hang + f.dur) {
          b.state = "collected";
          const kind = treasureKind(b.type);
          if (kind) {
            const r = this.creditedNew.get(b) ?? this.treasure.add(b.type.id, this.pad.name);
            this.creditedNew.delete(b);
            sfx.land("glass", b.type.mass * 0.6);
            this.emit("treasure", {
              type: b.type, kind, isNew: r.isNew, count: this.treasure.count(b.type.id), padName: this.pad.name,
              targetHit: r.targetHit, setDone: r.setDone?.name, shelved: r.shelved,
            });
          } else {
            const vx = (f.x1 - f.cx) * 2;
            const vy = (f.y1 - f.cy) * 2;
            this.collector.add(b, vx, vy);
            if (!b.fiber || this.tactile.popStyle(b).landSound) sfx.land(b.type.id === "king" ? "glass" : b.type.material, b.type.mass);
          }
          b.fly = undefined;
          // the magnet's last bead is in: a burst of confetti under the fingers
          if (this.magnetized.delete(b) && !this.magnetized.size && this.remainingCount() === 0) {
            this.magnetEnd = this.time;
            haptics.magnetDone();
          }
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
        // every bead that landed in the jar drops into the bead box (bonus digs too)
        this.bracelets.addBeads(this.collector.items.map((it) => [it.bead.type.id, it.bead.color] as [string, string]));
        // keep this jar for the album (bonus digs are small extras, not a pad of their own)
        if (!this.bonusRound) {
          this.album.add({
            at: Date.now(),
            pad: this.pad.name,
            padId: this.pad.id,
            beads: this.collector.items.map((it) => [it.bead.type.id, it.bead.color] as [string, string]),
          });
        }
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
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].t += dt;
      if (this.bursts[i].t > 0.45) this.bursts.splice(i, 1);
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
    this.tactile.draw(ctx, dpr);
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

    this.drawMagnetPull(ctx);
    for (const b of this.beads) if (b.state === "flying" && b.fly) drawFlying(ctx, b, this, this.reducedMotion);
    this.drawMagnetGlitter(ctx);
    this.collector.draw(ctx, dpr);
    drawJarFinale(ctx, this.finaleT, this.collector, this.reducedMotion);
    const hint = this.tactile.hintText();
    if (hint !== this.hint) {
      this.hint = hint;
      this.emit("tactileHint", { text: hint });
    }
  }

  /** the jar drawing the last beads in: a soft halo behind it and rings closing on its mouth */
  private drawMagnetPull(ctx: CanvasRenderingContext2D) {
    if (this.magnetAt < 0) return;
    const t = this.time - this.magnetAt;
    const out = this.magnetEnd < 0 ? 1 : clamp(1 - (this.time - this.magnetEnd) / 0.5, 0, 1);
    const k = Math.min(1, t / 0.25) * out;
    if (k <= 0) return;
    const c = this.collector;
    const x = c.x + c.w / 2;
    const y = c.y + c.h * 0.3;
    const R = c.w * 0.98;
    const pulse = this.reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(t * 12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(255, 228, 244, ${0.85 * k * pulse})`);
    g.addColorStop(0.55, `rgba(236, 150, 200, ${0.3 * k * pulse})`);
    g.addColorStop(1, "rgba(236, 150, 200, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    if (this.reducedMotion) return;
    ctx.save();
    ctx.strokeStyle = "#e07fb2";
    for (let i = 0; i < 3; i++) {
      const p = (t * 1.6 + i / 3) % 1;
      const r = R * (1.2 - p);
      ctx.globalAlpha = k * Math.sin(p * Math.PI) * 0.75;
      ctx.lineWidth = 1 + 2 * (1 - p);
      ctx.beginPath();
      ctx.ellipse(x, c.entry.y + 10, r, r * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** glitter behind every bead the magnet carries, and a small star burst where each let go */
  private drawMagnetGlitter(ctx: CanvasRenderingContext2D) {
    for (const b of this.magnetized) {
      const f = b.fly;
      if (!f) continue;
      for (let j = 1; j <= 4; j++) {
        const at = f.t - j * 0.04;
        if (at <= 0) break;
        const p = flyPos(b, this, at);
        const wob = this.reducedMotion ? 0 : Math.sin(f.t * 23 + j * 1.7 + b.id) * 3;
        drawFinishStar(ctx, p.x + wob, p.y - wob, (5.4 - j) * 1.15, (1 - j / 5) * 0.95, j % 2 ? "#ffcf5a" : "#ff93c9");
      }
    }
    for (const u of this.bursts) {
      const k = u.t / 0.45;
      const r = (10 + 26 * easeOutCubic(k)) * this.s;
      for (let i = 0; i < 6; i++) {
        const a = u.turn + (i / 6) * Math.PI * 2;
        drawFinishStar(ctx, u.x + Math.cos(a) * r, u.y + Math.sin(a) * r * 0.8, (i % 2 ? 4 : 5.5) * (1 - k * 0.5) * this.s, 1 - k, i % 2 ? "#ffcf5a" : "#ff93c9");
      }
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

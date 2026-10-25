import { PADS, VARIANTS, applyVariant, padById, resolvePad, type PadType } from "./PadTypes";
import { FIRST_VARIANT_PAD, VARIANT_CHANCE } from "../rewards/rates";
import { THEME_CHANCE, THEME_FROM, activeTheme, themePads } from "../rewards/themes";

/**
 * Where the player is, and what comes next – the whole save file.
 *
 *  FIRST_DISCOVERY  the eight base pads, once each, in order. Resuming never
 *                   sends you back to the start: you continue at the first pad
 *                   you have not discovered yet.
 *  COLLECTION       every base pad seen → pads come in a weighted random order
 *                   (no immediate repeats, recent ones rarer, neglected ones
 *                   a little more likely), with variants, pooled treasures and
 *                   the rare NEXT.
 *
 * A pad closed mid-way restarts fresh next time; a pad finished but not yet
 * "opened through" resumes at the *next* pad. Bead positions are never saved.
 */
export type Mode = "FIRST_DISCOVERY" | "COLLECTION";

const KEY = "ssok.progress.v2";
const LEGACY_KEY = "ssok.pads.v1";
/** the player's own calendar day (a Korean player's day starts at midnight, not 9am UTC) */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const strings = (v: unknown, valid: (id: string) => boolean): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && valid(x)).filter((x, i, a) => a.indexOf(x) === i) : [];

/** keep every field that is well-formed, repair the rest – a bad field must not wipe the whole save */
function sanitize(raw: unknown): Save {
  const s = fresh();
  if (!raw || typeof raw !== "object") return s;
  const o = raw as Record<string, unknown>;
  if (o.mode === "COLLECTION" || o.mode === "FIRST_DISCOVERY") s.mode = o.mode;
  if (typeof o.current === "string" && resolvePad(o.current)) s.current = o.current;
  s.currentDone = o.currentDone === true;
  s.discoveredPads = strings(o.discoveredPads, (id) => !!padById(id));
  s.discoveredVariants = strings(o.discoveredVariants, (id) => !!resolvePad(id));
  if (o.playCount && typeof o.playCount === "object") {
    for (const [k, v] of Object.entries(o.playCount as Record<string, unknown>)) {
      if (padById(k) && Number.isFinite(v) && (v as number) >= 0) s.playCount[k] = Math.floor(v as number);
    }
  }
  if (Number.isFinite(o.totalCompleted) && (o.totalCompleted as number) >= 0) s.totalCompleted = Math.floor(o.totalCompleted as number);
  if (typeof o.lastPlayDate === "string") s.lastPlayDate = o.lastPlayDate;
  s.recent = Array.isArray(o.recent) ? o.recent.filter((x): x is string => typeof x === "string" && !!padById(x)).slice(-10) : [];
  if (typeof o.nextId === "string" && resolvePad(o.nextId)) {
    s.nextId = o.nextId;
    if (typeof o.nextHidden === "string" || o.nextHidden === null) s.nextHidden = o.nextHidden;
  }
  if (typeof o.currentHidden === "string" || o.currentHidden === null) s.currentHidden = o.currentHidden;
  s.nextCaught = o.nextCaught === true && s.nextId !== null;
  if (typeof o.bonusTreasure === "string") s.bonusTreasure = o.bonusTreasure;
  if (typeof o.currentDaily === "string") s.currentDaily = o.currentDaily;
  s.currentRainbow = o.currentRainbow === true && s.currentDaily !== "";
  s.magnetOwed = o.magnetOwed === true && !s.currentDone;
  s.dayBonusPending = o.dayBonusPending === true;
  s.recentColors = Array.isArray(o.recentColors)
    ? o.recentColors.filter((x): x is string => typeof x === "string" && /^\d+,\d+,\d+$/.test(x)).slice(-8)
    : [];
  return s;
}

interface Save {
  v: 2;
  mode: Mode;
  /** id of the pad on the table (base id or "base:variant") */
  current: string;
  /** the pad on the table has been emptied (door not yet taken) */
  currentDone: boolean;
  discoveredPads: string[];
  discoveredVariants: string[];
  /** per base pad */
  playCount: Record<string, number>;
  totalCompleted: number;
  lastPlayDate: string;
  /** last base pads played, oldest first, for the weighted draw */
  recent: string[];
  /** the rolled next pad, so NEXT and the door – and a restart – all agree */
  nextId: string | null;
  /** the treasure pre-rolled for that next pad (null = rolled "none", undefined = not rolled) */
  nextHidden: string | null | undefined;
  /** what the pad on the table buries (null = nothing, undefined = not known): a restart
   * mid-pad buries the same thing, so a treasure planted through an ad is never lost */
  currentHidden: string | null | undefined;
  /** the passing variant's ad already paid out: a restart opens the variant, not the plain pad */
  nextCaught: boolean;
  /** the sure treasure of a paid "한 번 더 파기" that is not dug up yet: a restart digs it
   * first – the same treasure, never a re-roll, and never again once it is found */
  bonusTreasure: string | null;
  /** the pad on the table is the gel of this day ("" = an ordinary pad): a restart rebuilds it */
  currentDaily: string;
  /** …in rainbow silicone (a streak's reward): a restart rebuilds it as one, whatever day it is */
  currentRainbow: boolean;
  /** a "자석 싹쓸이" ad paid out on the pad on the table and the pad is not emptied yet: a restart
   * (fresh beads) owes one magnet without an ad on this pad */
  magnetOwed: boolean;
  /** first pad of a new day gets one small nudge; consumed when that pad is generated */
  dayBonusPending: boolean;
  /** gel colours of the last pads opened ("r,g,b", newest last) – no repeats */
  recentColors: string[];
}

const fresh = (): Save => ({
  v: 2,
  mode: "FIRST_DISCOVERY",
  current: PADS[0].id,
  currentDone: false,
  discoveredPads: [],
  discoveredVariants: [],
  playCount: {},
  totalCompleted: 0,
  lastPlayDate: "",
  recent: [],
  nextId: null,
  nextHidden: undefined,
  currentHidden: undefined,
  nextCaught: false,
  bonusTreasure: null,
  currentDaily: "",
  currentRainbow: false,
  magnetOwed: false,
  dayBonusPending: false,
  recentColors: [],
});

export class PadProgress {
  private s: Save = fresh();
  private listeners = new Set<() => void>();
  /** set at load when the calendar day changed since the last play */
  readonly newDay: boolean;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.s = sanitize(JSON.parse(raw));
      else {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) this.migrate(JSON.parse(legacy));
      }
    } catch {
      this.s = fresh();
    }
    if (!padById(this.s.current)) this.s.current = PADS[0].id;
    this.newDay = this.s.lastPlayDate !== "" && this.s.lastPlayDate !== today();
    if (this.newDay) this.s.dayBonusPending = true;
    this.s.lastPlayDate = today();
    this.refreshMode();
    this.save();
  }

  /** v1 → v2: keep what was discovered, forget the rest */
  private migrate(old: { current?: string; opened?: string[]; completed?: string[]; finished?: number }) {
    const s = fresh();
    s.current = old.current && padById(old.current) ? old.current : PADS[0].id;
    s.discoveredPads = (old.opened ?? []).map((id) => id.split(":")[0]).filter((id, i, a) => padById(id) && a.indexOf(id) === i);
    s.totalCompleted = old.finished ?? 0;
    for (const id of old.completed ?? []) s.playCount[id] = 1;
    this.s = s;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  private refreshMode() {
    if (PADS.every((p) => this.s.discoveredPads.includes(p.id))) this.s.mode = "COLLECTION";
  }

  // ─── reads ─────────────────────────────────────────────────────
  get mode(): Mode {
    return this.s.mode;
  }
  get current(): PadType {
    return resolvePad(this.s.current) ?? PADS[0];
  }
  get currentDone() {
    return this.s.currentDone;
  }
  get totalCompleted() {
    return this.s.totalCompleted;
  }
  get discoveredPads(): readonly string[] {
    return this.s.discoveredPads;
  }
  get discoveredVariants(): readonly string[] {
    return this.s.discoveredVariants;
  }
  isDiscovered(baseId: string) {
    return this.s.discoveredPads.includes(baseId);
  }
  isVariantDiscovered(variantPadId: string) {
    return this.s.discoveredVariants.includes(variantPadId);
  }
  playCount(baseId: string) {
    return this.s.playCount[baseId] ?? 0;
  }
  get recent(): readonly string[] {
    return this.s.recent;
  }
  get nextId() {
    return this.s.nextId;
  }
  get nextHidden() {
    return this.s.nextHidden;
  }
  get currentHidden() {
    return this.s.currentHidden;
  }
  get nextCaught() {
    return this.s.nextCaught;
  }
  get bonusTreasure() {
    return this.s.bonusTreasure;
  }
  get currentDaily() {
    return this.s.currentDaily;
  }
  get currentRainbow() {
    return this.s.currentRainbow;
  }
  get magnetOwed() {
    return this.s.magnetOwed;
  }
  get recentColors(): readonly string[] {
    return this.s.recentColors;
  }
  /** remember a gel colour that went on the table */
  noteColor(key: string) {
    this.s.recentColors = [...this.s.recentColors, key].slice(-8);
    this.save();
  }
  /** 1-based index of the pad on the table (completion is counted at the last POP) */
  get padIndex() {
    return this.s.totalCompleted + (this.s.currentDone ? 0 : 1);
  }
  /** the calendar day turned while the game stayed open – the same as starting on a new day */
  rollDay() {
    const day = today();
    if (this.s.lastPlayDate === day) return false;
    this.s.lastPlayDate = day;
    this.s.dayBonusPending = true;
    this.save();
    return true;
  }
  /** one small nudge for the first pad of a new day – true exactly once */
  takeDayBonus() {
    if (!this.s.dayBonusPending) return false;
    this.s.dayBonusPending = false;
    this.save();
    return true;
  }

  // ─── writes ────────────────────────────────────────────────────
  /** a pad is put on the table (fresh beads) */
  open(pad: PadType): { newPad: boolean; newVariant: boolean } {
    const base = pad.variantOf ?? pad.id;
    const newPad = !this.s.discoveredPads.includes(base);
    if (newPad) this.s.discoveredPads.push(base);
    const newVariant = !!pad.variantOf && !this.s.discoveredVariants.includes(pad.id);
    if (newVariant) this.s.discoveredVariants.push(pad.id);
    this.s.current = pad.id;
    this.s.currentDone = false;
    this.s.playCount[base] = (this.s.playCount[base] ?? 0) + 1;
    this.s.recent = [...this.s.recent, base].slice(-10);
    this.s.nextId = null;
    this.s.nextHidden = undefined;
    this.s.currentHidden = undefined;
    this.s.nextCaught = false;
    this.s.bonusTreasure = null;
    this.s.currentDaily = pad.daily ?? "";
    this.s.currentRainbow = !!pad.daily && !!pad.rainbow;
    this.s.magnetOwed = false;
    this.refreshMode();
    this.save();
    return { newPad, newVariant };
  }
  /** what the pad on the table buries – null again once it has been dug up */
  setCurrentHidden(hidden: string | null) {
    this.s.currentHidden = hidden;
    this.save();
  }
  /** the rewarded door for the passing variant paid out (set at the earned-reward event) */
  catchNext() {
    if (!this.s.nextId) return;
    this.s.nextCaught = true;
    this.save();
  }
  /** a bonus dig paid for (its treasure) or its treasure dug up (null) */
  setBonusTreasure(id: string | null) {
    if (this.s.bonusTreasure === id) return;
    this.s.bonusTreasure = id;
    this.save();
  }
  /** a magnet's ad paid out on the pad on the table (set at the earned-reward event) */
  oweMagnet() {
    if (this.s.currentDone || this.s.magnetOwed) return;
    this.s.magnetOwed = true;
    this.save();
  }
  /** the pad on the table was emptied */
  complete() {
    if (this.s.currentDone) return;
    this.s.currentDone = true;
    this.s.totalCompleted++;
    this.s.magnetOwed = false;
    this.save();
  }
  /** remember what NEXT rolled (and what it hides) so a restart lands on the same pad */
  setNext(pad: PadType, hidden: string | null) {
    if (this.s.nextId !== pad.id) this.s.nextCaught = false;
    this.s.nextId = pad.id;
    this.s.nextHidden = hidden;
    this.save();
  }
}

// ─── what comes next ───────────────────────────────────────────────
export interface NextPadProvider {
  next(progress: PadProgress): PadType;
  /** the next pad plus `extra` distinct others, for the "광고 보고 고르기" door */
  choices?(progress: PadProgress, next: PadType, extra: number): PadType[];
}

/**
 * FIRST_DISCOVERY: the first base pad not yet discovered, in the fixed order.
 * COLLECTION: weighted random over base pads – the pad just played cannot
 * repeat, the two before it are much rarer, pads not seen for a while creep up.
 * Both get a variant roll (rare / super) on top; a player who has never met a
 * variant is handed one as the FIRST_VARIANT_PAD-th pad.
 */
export class DiscoveryProvider implements NextPadProvider {
  constructor(private rand: () => number = Math.random, private now: () => Date = () => new Date()) {}

  next(progress: PadProgress): PadType {
    const forceRare = progress.discoveredVariants.length === 0 && progress.padIndex + 1 === FIRST_VARIANT_PAD;
    // the forced variant pad must be a pad that has variants; theme pads have none
    if (!forceRare) {
      const seasonal = this.seasonal(progress);
      if (seasonal) return seasonal;
    }
    const base = this.nextBase(progress);
    return this.rollVariant(base, forceRare);
  }

  /** now and then, one of this month's limited pads (never twice in a row, not in the opening pads) */
  private seasonal(progress: PadProgress): PadType | undefined {
    const theme = activeTheme(this.now());
    if (!theme || progress.totalCompleted < THEME_FROM) return undefined;
    const last = progress.recent[progress.recent.length - 1];
    const cur = progress.current.variantOf ?? progress.current.id;
    const pads = themePads(theme).filter((p) => p.id !== last && p.id !== cur);
    if (!pads.length) return undefined;
    const fresh = pads.filter((p) => !progress.isDiscovered(p.id));
    if (this.rand() >= (fresh.length ? THEME_CHANCE.undiscovered : THEME_CHANCE.discovered)) return undefined;
    const pool = fresh.length ? fresh : pads;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  /** the next pad plus `extra` other base pads, all distinct – for "광고 보고 고르기" */
  choices(progress: PadProgress, next: PadType, extra: number): PadType[] {
    const out = [next];
    const taken = new Set([next.variantOf ?? next.id]);
    for (let guard = 0; out.length < 1 + extra && guard < 40; guard++) {
      const p = this.nextBase(progress, taken);
      if (!p) break;
      taken.add(p.id);
      out.push(p);
    }
    return out;
  }

  private nextBase(progress: PadProgress, exclude: ReadonlySet<string> = new Set()): PadType | undefined {
    if (progress.mode === "FIRST_DISCOVERY") {
      const curBase = progress.current.variantOf ?? progress.current.id;
      const undiscovered = PADS.filter((p) => !progress.isDiscovered(p.id) && p.id !== curBase && !exclude.has(p.id));
      if (undiscovered.length) return undiscovered[0];
      // everything seen: fall through to the collection draw
    }
    const recent = progress.recent;
    const last = recent[recent.length - 1];
    const weights = PADS.map((p) => {
      if (p.id === last || exclude.has(p.id)) return 0;
      let w = 1;
      const idx = recent.lastIndexOf(p.id);
      if (idx >= 0 && recent.length - 1 - idx <= 2) w *= 0.25; // the two before last
      const gap = idx < 0 ? 6 : recent.length - 1 - idx;
      w += 0.12 * Math.min(5, gap); // neglected pads creep up
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return undefined;
    let r = this.rand() * total;
    for (let i = 0; i < PADS.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) return PADS[i];
    }
    return PADS.filter((p) => !exclude.has(p.id) && p.id !== last).pop();
  }

  /** once in a while the next pad is a variant – decided here, once. `forceRare` makes it one for sure. */
  rollVariant(base: PadType | undefined, forceRare = false): PadType {
    base ??= PADS[0];
    const vs = VARIANTS[base.id] ?? [];
    if (!vs.length) return base;
    const r = this.rand();
    const supers = vs.filter((v) => v.tier === "super");
    const rares = vs.filter((v) => v.tier === "rare");
    const pick = <T>(a: T[]) => a[Math.floor(this.rand() * a.length)];
    if (supers.length && r < VARIANT_CHANCE.super) return applyVariant(base, pick(supers));
    if (rares.length && (forceRare || r < VARIANT_CHANCE.super + VARIANT_CHANCE.rare)) return applyVariant(base, pick(rares));
    return base;
  }
}

/** Variants may be selected via the optional rewarded transition. */
export function isRareVariant(p: PadType) {
  return !!p.tier;
}

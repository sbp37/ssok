import { PADS, VARIANTS, applyVariant, padById, resolvePad, type PadType } from "./PadTypes";
import { VARIANT_CHANCE } from "../rewards/rates";

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
const today = () => new Date().toISOString().slice(0, 10);

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
  /** first pad of a new day gets one small nudge; consumed when that pad is generated */
  dayBonusPending: boolean;
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
  dayBonusPending: false,
});

export class PadProgress {
  private s: Save = fresh();
  private listeners = new Set<() => void>();
  /** set at load when the calendar day changed since the last play */
  readonly newDay: boolean;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.s = { ...fresh(), ...JSON.parse(raw) };
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
    this.refreshMode();
    this.save();
    return { newPad, newVariant };
  }
  /** the pad on the table was emptied */
  complete() {
    if (this.s.currentDone) return;
    this.s.currentDone = true;
    this.s.totalCompleted++;
    this.save();
  }
  /** remember what NEXT rolled (and what it hides) so a restart lands on the same pad */
  setNext(pad: PadType, hidden: string | null) {
    this.s.nextId = pad.id;
    this.s.nextHidden = hidden;
    this.save();
  }
}

// ─── what comes next ───────────────────────────────────────────────
export interface NextPadProvider {
  next(progress: PadProgress): PadType;
}

/**
 * FIRST_DISCOVERY: the first base pad not yet discovered, in the fixed order.
 * COLLECTION: weighted random over base pads – the pad just played cannot
 * repeat, the two before it are much rarer, pads not seen for a while creep up
 * – then a variant roll (rare / super) on top.
 */
export class DiscoveryProvider implements NextPadProvider {
  constructor(private rand: () => number = Math.random) {}

  next(progress: PadProgress): PadType {
    if (progress.mode === "FIRST_DISCOVERY") {
      const curBase = progress.current.variantOf ?? progress.current.id;
      const undiscovered = PADS.filter((p) => !progress.isDiscovered(p.id) && p.id !== curBase);
      if (undiscovered.length) return undiscovered[0];
      // everything seen: fall through to the collection draw
    }
    const recent = progress.recent;
    const last = recent[recent.length - 1];
    const weights = PADS.map((p) => {
      if (p.id === last) return 0;
      let w = 1;
      const idx = recent.lastIndexOf(p.id);
      if (idx >= 0 && recent.length - 1 - idx <= 2) w *= 0.25; // the two before last
      const gap = idx < 0 ? 6 : recent.length - 1 - idx;
      w += 0.12 * Math.min(5, gap); // neglected pads creep up
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rand() * total;
    let base = PADS[PADS.length - 1];
    for (let i = 0; i < PADS.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        base = PADS[i];
        break;
      }
    }
    return this.rollVariant(base);
  }

  /** once in a while the next pad is a variant – decided here, once */
  rollVariant(base: PadType): PadType {
    const vs = VARIANTS[base.id] ?? [];
    if (!vs.length) return base;
    const r = this.rand();
    const supers = vs.filter((v) => v.tier === "super");
    const rares = vs.filter((v) => v.tier === "rare");
    const pick = <T>(a: T[]) => a[Math.floor(this.rand() * a.length)];
    if (supers.length && r < VARIANT_CHANCE.super) return applyVariant(base, pick(supers));
    if (rares.length && r < VARIANT_CHANCE.super + VARIANT_CHANCE.rare) return applyVariant(base, pick(rares));
    return base;
  }
}

/** Future rewarded-ad seam. Mock today: "watching" just succeeds after a beat. */
export interface RewardedUnlockProvider {
  canWatch(): boolean;
  watch(): Promise<boolean>;
}
export class MockRewardedProvider implements RewardedUnlockProvider {
  canWatch() {
    return true;
  }
  watch() {
    return new Promise<boolean>((res) => setTimeout(() => res(true), 450));
  }
}

/** a variant pad is the only thing an ad is ever offered for – and it can always be skipped */
export function isRareVariant(p: PadType) {
  return !!p.tier;
}

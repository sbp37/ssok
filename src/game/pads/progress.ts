import { PADS, VARIANTS, applyVariant, padById, type PadType } from "./PadTypes";
import { VARIANT_CHANCE } from "../rewards/rates";

/**
 * Which pad comes next, and what has been opened. Deliberately small: a fixed
 * first-run order today, with the provider seam left for random / rare pads.
 */
export interface NextPadProvider {
  /** the pad after `current` (or the first one) */
  next(currentId: string | null): PadType;
}

export class SequenceProvider implements NextPadProvider {
  constructor(
    private order: readonly string[] = PADS.map((p) => p.id),
    private rand: () => number = Math.random,
  ) {}
  next(currentId: string | null) {
    const baseId = currentId ? currentId.split(":")[0] : null;
    let base: PadType;
    if (!baseId) base = padById(this.order[0])!;
    else base = padById(this.order[(this.order.indexOf(baseId) + 1) % this.order.length])!;
    // once in a while the next pad is a variant – rolled here, once, so the
    // NEXT tease and the pad that actually opens agree
    const vs = VARIANTS[base.id] ?? [];
    const r = this.rand();
    const superV = vs.find((v) => v.tier === "super");
    const rareV = vs.find((v) => v.tier === "rare");
    if (superV && r < VARIANT_CHANCE.super) return applyVariant(base, superV);
    if (rareV && r < VARIANT_CHANCE.super + VARIANT_CHANCE.rare) return applyVariant(base, rareV);
    if (!rareV && superV && r < VARIANT_CHANCE.super + VARIANT_CHANCE.rare) return applyVariant(base, superV);
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

const KEY = "ssok.pads.v1";
interface Blob {
  current: string;
  completed: string[];
  /** pads the player has opened at least once */
  opened: string[];
  /** how many pads were finished in total (drives when the unlock hook may appear) */
  finished: number;
}

export class PadProgress {
  private data: Blob = { current: PADS[0].id, completed: [], opened: [PADS[0].id], finished: 0 };
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
      if (!padById(this.data.current)) this.data.current = PADS[0].id;
    } catch {
      /* ignore */
    }
  }
  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
  get current() {
    return padById(this.data.current)!;
  }
  /** how many pads have been emptied in total */
  get completedCount() {
    return this.data.finished;
  }
  get finished() {
    return this.data.finished;
  }
  isOpened(id: string) {
    return this.data.opened.includes(id);
  }
  complete(id: string) {
    if (!this.data.completed.includes(id)) this.data.completed.push(id);
    this.data.finished++;
    this.save();
  }
  open(pad: PadType) {
    this.data.current = pad.id;
    if (!this.data.opened.includes(pad.id)) this.data.opened.push(pad.id);
    this.save();
  }
  /** a pad previously opened, other than `exceptId` – what "나중에" falls back to */
  fallback(exceptId: string): PadType {
    const pool = this.data.opened.filter((id) => id !== exceptId);
    const id = pool.length ? pool[Math.floor(Math.random() * pool.length)] : PADS[0].id;
    return padById(id)!;
  }
}

/** a variant pad is the only thing an ad is ever offered for – and it can always be skipped */
export function isRareVariant(p: PadType) {
  return !!p.tier;
}

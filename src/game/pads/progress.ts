import { PADS, padById, type PadType } from "./PadTypes";

/**
 * Which pad comes next, and what has been opened. Deliberately small: a fixed
 * first-run order today, with the provider seam left for random / rare pads.
 */
export interface NextPadProvider {
  /** the pad after `current` (or the first one) */
  next(currentId: string | null): PadType;
}

export class SequenceProvider implements NextPadProvider {
  constructor(private order: readonly string[] = PADS.map((p) => p.id)) {}
  next(currentId: string | null) {
    if (!currentId) return padById(this.order[0])!;
    const i = this.order.indexOf(currentId);
    return padById(this.order[(i + 1) % this.order.length])!;
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

/**
 * The first four pads flow freely. From then on, every other new pad is
 * offered behind the (mock) rewarded unlock – the player has felt the toy and
 * seen it change shape before anything asks for their attention.
 */
export function isGated(progress: PadProgress, next: PadType) {
  if (progress.isOpened(next.id)) return false;
  if (progress.finished < 4) return false;
  return (progress.finished - 4) % 2 === 0;
}

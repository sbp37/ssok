import type { ChallengeResult } from "../modes/Challenge";

/**
 * Records. Local-only today; the interfaces are what a server-backed
 * ranking would implement later. No fake ranking data anywhere – if we
 * don't have real numbers we show nothing.
 */
export type ModeId = "challenge30";

export interface RecordStore {
  getBest(mode: ModeId): ChallengeResult | null;
  /** stores the result; returns whether it became the new best */
  submit(mode: ModeId, r: ChallengeResult): { isBest: boolean; previous: ChallengeResult | null };
  history(mode: ModeId): ChallengeResult[];
}

/** Future: today / all-time / friends rankings. Intentionally unimplemented. */
export interface RankingProvider {
  fetchToday(mode: ModeId): Promise<RankingEntry[]>;
  fetchAll(mode: ModeId): Promise<RankingEntry[]>;
  submit(mode: ModeId, r: ChallengeResult): Promise<{ percentile?: number }>;
}
export interface RankingEntry {
  name: string;
  score: number;
  at: number;
}

const KEY = "ssok.records.v1";
interface Blob {
  best: Partial<Record<ModeId, ChallengeResult>>;
  history: Partial<Record<ModeId, ChallengeResult[]>>;
}

export class LocalRecordStore implements RecordStore {
  private data: Blob = { best: {}, history: {} };
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { best: {}, history: {}, ...JSON.parse(raw) };
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
  getBest(mode: ModeId) {
    return this.data.best[mode] ?? null;
  }
  history(mode: ModeId) {
    return this.data.history[mode] ?? [];
  }
  submit(mode: ModeId, r: ChallengeResult) {
    const previous = this.getBest(mode);
    const isBest = !previous || r.score > previous.score;
    if (isBest) this.data.best[mode] = r;
    const h = this.data.history[mode] ?? [];
    h.push(r);
    this.data.history[mode] = h.slice(-50);
    this.save();
    return { isBest, previous };
  }
}

export const records: RecordStore = new LocalRecordStore();

import { BEAD_TYPES, HIDDEN_TYPES, ULTRA_TYPES, type BeadType } from "../beads/BeadTypes";

/**
 * The treasure box: which rare things have been found, how many times.
 * Kinds: "rare" (a rare bead), "hidden" (a pad's buried object), "ultra".
 */
export type TreasureKind = "rare" | "hidden" | "ultra";

export function treasureKind(t: BeadType): TreasureKind | null {
  if (t.rarity === "rare") return "rare";
  if (t.rarity === "hidden") return "hidden";
  if (t.rarity === "ultra") return "ultra";
  return null;
}

/** everything the box can hold, in display order */
export const TREASURE_TYPES: readonly BeadType[] = [
  ...BEAD_TYPES.filter((t) => t.rarity === "rare"),
  ...HIDDEN_TYPES,
  ...ULTRA_TYPES,
];

const KEY = "ssok.treasure.v1";
interface Blob {
  counts: Record<string, number>;
  firstAt: Record<string, number>;
  /** special (non-treasure) beads pulled, by type – shown in the collection, never celebrated */
  seen: Record<string, number>;
}

/** the 특수 row of the collection: pretty everyday shapes */
export const SPECIAL_TYPES: readonly BeadType[] = BEAD_TYPES.filter((t) => t.rarity === "special");
/** the 희귀 row: rare beads and every pad's buried object */
export const RARE_TYPES: readonly BeadType[] = [...BEAD_TYPES.filter((t) => t.rarity === "rare"), ...HIDDEN_TYPES];

export class TreasureStore {
  private data: Blob = { counts: {}, firstAt: {}, seen: {} };
  private listeners = new Set<() => void>();
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { counts: {}, firstAt: {}, seen: {}, ...JSON.parse(raw) };
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
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  count(id: string) {
    return this.data.counts[id] ?? 0;
  }
  has(id: string) {
    return this.count(id) > 0;
  }
  /** records a find; returns whether it was the first of its kind */
  add(id: string) {
    const isNew = !this.has(id);
    this.data.counts[id] = this.count(id) + 1;
    if (isNew) this.data.firstAt[id] = Date.now();
    this.save();
    return isNew;
  }
  /** a special bead was pulled (no fanfare – it just fills its card) */
  noteSpecial(id: string) {
    this.data.seen[id] = (this.data.seen[id] ?? 0) + 1;
    this.save();
  }
  specialCount(id: string) {
    return this.data.seen[id] ?? 0;
  }
  get found() {
    return Object.keys(this.data.counts).length;
  }
  get total() {
    return TREASURE_TYPES.length;
  }
}

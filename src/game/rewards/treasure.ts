import { BEAD_TYPES, HIDDEN_TYPES, ULTRA_TYPES, type BeadType } from "../beads/BeadTypes";
import { completedBy, type TreasureSet } from "./sets";

/** how many treasures the shelf shows */
export const SHELF_SIZE = 5;

/** what one find meant, for the toast */
export interface FindResult {
  isNew: boolean;
  /** it was the pinned target */
  targetHit: boolean;
  /** it completed this set */
  setDone?: TreasureSet;
  /** it went straight onto the (empty) shelf */
  shelved: boolean;
}

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
  /** the pad a treasure was first found in (name) */
  firstPad: Record<string, string>;
  /** treasure ids on the shelf, left to right */
  shelf: string[];
  /** the missing treasure the player is looking for */
  target: string | null;
  /** completed pads since the last first-time find (drives the gentle catch-up for missing treasures) */
  dry: number;
}

/** the 특수 row of the collection: pretty everyday shapes */
export const SPECIAL_TYPES: readonly BeadType[] = BEAD_TYPES.filter((t) => t.rarity === "special");
/** the 희귀 row: rare beads and every pad's buried object */
export const RARE_TYPES: readonly BeadType[] = [...BEAD_TYPES.filter((t) => t.rarity === "rare"), ...HIDDEN_TYPES];

/** a stored id → number map, with anything malformed dropped */
function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v)) if (Number.isFinite(n) && (n as number) >= 0) out[k] = n as number;
  }
  return out;
}

export class TreasureStore {
  private data: Blob = { counts: {}, firstAt: {}, seen: {}, firstPad: {}, shelf: [], target: null, dry: 0 };
  private listeners = new Set<() => void>();
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw) as Partial<Blob> | null;
        const known = (id: unknown): id is string => typeof id === "string" && TREASURE_TYPES.some((t) => t.id === id);
        const counts = numbers(o?.counts);
        const firstPad: Record<string, string> = {};
        if (o?.firstPad && typeof o.firstPad === "object") {
          for (const [k, v] of Object.entries(o.firstPad)) if (typeof v === "string") firstPad[k] = v;
        }
        this.data = {
          counts,
          firstAt: numbers(o?.firstAt),
          seen: numbers(o?.seen),
          firstPad,
          shelf: Array.isArray(o?.shelf)
            ? o.shelf.filter((id): id is string => known(id) && (counts[id] ?? 0) > 0).filter((id, i, a) => a.indexOf(id) === i).slice(0, SHELF_SIZE)
            : [],
          target: known(o?.target) && !(counts[o.target] > 0) ? o.target : null,
          dry: Number.isFinite(o?.dry) && (o!.dry as number) >= 0 ? Math.floor(o!.dry as number) : 0,
        };
      }
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
  /** records a find (saved at once) and says what it meant */
  add(id: string, padName?: string): FindResult {
    const isNew = !this.has(id);
    const setDone = isNew ? completedBy(id, (x) => this.has(x)) : undefined;
    this.data.counts[id] = this.count(id) + 1;
    const targetHit = this.data.target === id;
    let shelved = false;
    if (isNew) {
      this.data.firstAt[id] = Date.now();
      if (padName) this.data.firstPad[id] = padName;
      this.data.dry = 0;
      if (targetHit) this.data.target = null;
      // the very first find goes on the shelf by itself: the shelf is never empty for long
      if (!this.data.shelf.length) {
        this.data.shelf.push(id);
        shelved = true;
      }
    }
    this.save();
    return { isNew, targetHit, setDone, shelved };
  }
  /** a pad was completed without any first-time find */
  noteDryPad() {
    this.data.dry++;
    this.save();
  }
  get dry() {
    return this.data.dry;
  }
  firstFound(id: string): { at?: number; pad?: string } {
    return { at: this.data.firstAt[id], pad: this.data.firstPad[id] };
  }
  get shelf(): readonly string[] {
    return this.data.shelf;
  }
  onShelf(id: string) {
    return this.data.shelf.includes(id);
  }
  /** put on / take off the shelf; false when the shelf is full or the treasure is not found yet */
  toggleShelf(id: string): boolean {
    const i = this.data.shelf.indexOf(id);
    if (i >= 0) this.data.shelf.splice(i, 1);
    else if (!this.has(id) || this.data.shelf.length >= SHELF_SIZE) return false;
    else this.data.shelf.push(id);
    this.save();
    return true;
  }
  get target() {
    return this.data.target;
  }
  /** pin a missing treasure to look for (null clears) */
  setTarget(id: string | null) {
    this.data.target = id && !this.has(id) ? id : null;
    this.save();
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

import { BEAD_TYPES, type BeadType } from "../beads/BeadTypes";
import { TREASURE_TYPES } from "./treasure";

/**
 * Bracelets: every pulled bead drops into a bead box, and a bracelet strings
 * some of them on a cord with one treasure as its charm. Nothing ever leaves
 * the collection: a bracelet only uses what is spare – beads pulled and not yet
 * strung, a treasure copy beyond those already hanging on bracelets. Untying a
 * bracelet gives everything back. Duplicates finally mean something.
 */
export const MIN_BEADS = 8;
export const MAX_BEADS = 16;
export const MAX_BRACELETS = 12;
export type Cord = "clear" | "pink" | "gold" | "glitter";
export const CORDS: readonly Cord[] = ["clear", "pink", "gold", "glitter"];
/** a look, never a material: the one cord behind a rewarded ad */
export const AD_CORD: Cord = "glitter";
export const CORD_NAMES: Record<Cord, string> = { clear: "투명 줄", pink: "분홍 줄", gold: "금색 줄", glitter: "반짝이 줄" };

export interface Bracelet {
  id: string;
  at: number;
  /** "typeId|#colour", in stringing order */
  beads: string[];
  /** the treasure hung as its charm */
  charm: string | null;
  cord: Cord;
}

const KEY = "ssok.bracelets.v1";
/** everyday beads can be strung; treasures stay in the treasure box and hang as charms */
export const STRINGABLE: readonly BeadType[] = BEAD_TYPES.filter((t) => t.rarity !== "rare");
export const beadKey = (typeId: string, color: string) => `${typeId}|${color}`;
export function splitKey(key: string) {
  const i = key.indexOf("|");
  return { typeId: key.slice(0, i), color: key.slice(i + 1) };
}
const stringable = (key: string) => {
  const { typeId, color } = splitKey(key);
  return STRINGABLE.some((t) => t.id === typeId) && /^#[0-9a-f]{6}$/i.test(color);
};
const isTreasure = (id: unknown): id is string => typeof id === "string" && TREASURE_TYPES.some((t) => t.id === id);

export class BraceletStore {
  private stock: Record<string, number> = {};
  private list: Bracelet[] = [];
  /** a glitter cord paid for (its ad's reward came) and not strung yet – kept even if the maker closed */
  private glitter = false;
  private listeners = new Set<() => void>();

  /**
   * `seed`: the beads already in the jar album – what a player from before bracelets starts with.
   * `owned`: how many of a treasure the box holds, to check saved charms against.
   */
  constructor(
    seed: () => readonly (readonly [string, string])[] = () => [],
    owned: (id: string) => number = () => Infinity,
    private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined,
  ) {
    let saved: { stock?: unknown; list?: unknown; glitter?: unknown } | null = null;
    try {
      this.storage ??= localStorage;
      saved = JSON.parse(this.storage.getItem(KEY) || "null");
    } catch {
      saved = null;
    }
    if (saved && typeof saved === "object") {
      if (saved.stock && typeof saved.stock === "object") {
        for (const [k, n] of Object.entries(saved.stock as Record<string, unknown>)) {
          if (stringable(k) && Number.isFinite(n) && (n as number) > 0) this.stock[k] = Math.floor(n as number);
        }
      }
      if (Array.isArray(saved.list)) {
        // a damaged save must not string more than was pulled, or hang more charms than were found:
        // the bracelets that overdraw are dropped (their beads stay in the box), an overdrawn charm comes off
        const strung = new Map<string, number>();
        const hung = new Map<string, number>();
        for (const b of saved.list as Partial<Bracelet>[]) {
          if (this.list.length >= MAX_BRACELETS) break;
          if (!b || typeof b.id !== "string" || !Array.isArray(b.beads)) continue;
          const beads = b.beads.filter((k): k is string => typeof k === "string" && stringable(k)).slice(0, MAX_BEADS);
          if (beads.length < MIN_BEADS) continue;
          const need = new Map<string, number>();
          for (const k of beads) need.set(k, (need.get(k) ?? 0) + 1);
          if ([...need].some(([k, n]) => (strung.get(k) ?? 0) + n > (this.stock[k] ?? 0))) continue;
          for (const [k, n] of need) strung.set(k, (strung.get(k) ?? 0) + n);
          let charm = isTreasure(b.charm) ? b.charm : null;
          if (charm && (hung.get(charm) ?? 0) + 1 > owned(charm)) charm = null;
          if (charm) hung.set(charm, (hung.get(charm) ?? 0) + 1);
          this.list.push({
            id: b.id,
            at: Number.isFinite(b.at) ? (b.at as number) : 0,
            beads,
            charm,
            cord: CORDS.includes(b.cord as Cord) ? (b.cord as Cord) : "clear",
          });
        }
      }
      this.glitter = saved.glitter === true;
    } else {
      try {
        this.addBeads(seed(), false);
      } catch {
        /* no album yet */
      }
    }
    this.save(false);
  }

  private save(notify = true) {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ stock: this.stock, list: this.list, glitter: this.glitter }));
    } catch {
      /* private mode: kept for this session */
    }
    if (notify) this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** beads pulled from a pad drop into the box ([type id, colour]); treasures are not beads here */
  addBeads(beads: readonly (readonly [string, string])[], notify = true) {
    let added = 0;
    for (const [typeId, color] of beads) {
      const key = beadKey(typeId, color);
      if (!stringable(key)) continue;
      this.stock[key] = (this.stock[key] ?? 0) + 1;
      added++;
    }
    if (added) this.save(notify);
  }

  /** copies of this bead strung on bracelets */
  private strung(key: string) {
    let n = 0;
    for (const b of this.list) for (const k of b.beads) if (k === key) n++;
    return n;
  }
  /** how many of this bead are spare (pulled − strung) */
  spare(key: string) {
    return Math.max(0, (this.stock[key] ?? 0) - this.strung(key));
  }
  /** every bead with a spare copy */
  spareBeads(): { key: string; n: number }[] {
    return Object.keys(this.stock)
      .map((key) => ({ key, n: this.spare(key) }))
      .filter((e) => e.n > 0);
  }
  /** spare beads in all */
  get spareTotal() {
    return this.spareBeads().reduce((s, e) => s + e.n, 0);
  }
  /** copies of a treasure hanging on bracelets */
  charmsUsed(id: string) {
    return this.list.filter((b) => b.charm === id).length;
  }
  /** copies of a treasure free to hang: found copies beyond those already on bracelets */
  charmFree(id: string, owned: number) {
    return Math.max(0, owned - this.charmsUsed(id));
  }

  get bracelets(): readonly Bracelet[] {
    return this.list;
  }
  /** a glitter cord is paid for and waiting */
  get hasGlitter() {
    return this.glitter;
  }
  /** the glitter cord's ad paid out (at the reward, not in the maker – a closed maker loses nothing) */
  earnGlitter() {
    this.glitter = true;
    this.save();
  }
  get full() {
    return this.list.length >= MAX_BRACELETS;
  }

  /** string a bracelet; null when something is not spare, the length is wrong or the box is full */
  make(beads: readonly string[], charm: string | null, cord: Cord, owned: (id: string) => number, now = Date.now()): Bracelet | null {
    if (this.full || beads.length < MIN_BEADS || beads.length > MAX_BEADS || !CORDS.includes(cord)) return null;
    if (cord === AD_CORD && !this.glitter) return null;
    const need = new Map<string, number>();
    for (const k of beads) need.set(k, (need.get(k) ?? 0) + 1);
    for (const [k, n] of need) if (!stringable(k) || this.spare(k) < n) return null;
    if (charm !== null && (!isTreasure(charm) || this.charmFree(charm, owned(charm)) < 1)) return null;
    const b: Bracelet = { id: `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, at: now, beads: [...beads], charm, cord };
    this.list.push(b);
    if (cord === AD_CORD) this.glitter = false; // one ad, one glitter bracelet
    this.save();
    return b;
  }

  /** untie: its beads and its charm are spare again */
  remove(id: string) {
    const i = this.list.findIndex((b) => b.id === id);
    if (i < 0) return false;
    this.list.splice(i, 1);
    this.save();
    return true;
  }
}

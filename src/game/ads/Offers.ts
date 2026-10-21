import type { BeadType } from "../beads/BeadTypes";
import { HIDDEN_TYPES } from "../beads/BeadTypes";
import type { PadType } from "../pads/PadTypes";
import { HIDDEN_POOLS } from "../rewards/rates";
import { TREASURE_SETS } from "../rewards/sets";

/**
 * The one optional rewarded-ad door on the completion screen. Every emptied
 * pad offers exactly one of these – never a row of "광고 보기" buttons – and
 * the reward is always more pulling, never a currency. Each door says what it
 * gives before the ad, in a picture where it can:
 *
 *  rare    the passing variant: catch it instead of the plain pad
 *  dig     this pad hid nothing → a small bonus pad with this treasure for sure
 *  seek    a missing treasure – the pinned one, or the one that finishes a set –
 *          is buried in the next pad (free with a plant ticket)
 *  choose  two other pads, shown before the ad; tap one to open it instead
 */
export type OfferKind = "rare" | "dig" | "seek" | "choose";

export interface Offer {
  kind: OfferKind;
  /** button line, e.g. "광고 보고 잡기" */
  title: string;
  /** small line under it: what you get */
  sub: string;
  /** seek: the treasure to bury */
  seekId?: string;
  seekName?: string;
  /** seek: it is the pinned treasure */
  pinned?: boolean;
  /** seek: paid with a plant ticket instead of an ad */
  free?: boolean;
  /** dig: the bonus pad's sure treasure, decided before the ad */
  digId?: string;
  /** dig: that treasure is not in the box yet (shown as a dark silhouette) */
  digNew?: boolean;
  /** choose: the pads to switch to, filled in by the screen (the plain door keeps the rolled one) */
  alternatives?: PadType[];
}

export interface OfferContext {
  /** the next pad is a rare / super variant */
  nextTier?: "rare" | "super";
  /** the pad just emptied had a buried object */
  hadTreasure: boolean;
  /** the pad just emptied was itself a bonus dig (no chained digs) */
  bonus: boolean;
  /** base id of the next pad, to prefer treasures that belong there */
  nextBase: string;
  /** which treasure ids have been found */
  found: (id: string) => boolean;
  /** completed pads so far – alternates the seek/choose doors */
  totalCompleted: number;
  /** the pinned ("📍 이거 찾을래") treasure */
  pinned?: string | null;
  /** free plant tickets the player holds */
  tickets?: number;
  /** what a bonus dig would bury, rolled by the game */
  dig?: { id: string; name: string } | null;
  rand?: () => number;
}

/** hidden (non-ultra) treasures not yet in the box, the next pad's own first */
export function seekCandidates(nextBase: string, found: (id: string) => boolean): BeadType[] {
  const pool = new Set((HIDDEN_POOLS[nextBase] ?? []).map((e) => e.id));
  const missing = HIDDEN_TYPES.filter((t) => !found(t.id));
  const own = missing.filter((t) => pool.has(t.id));
  return own.length ? own : missing;
}

/** the everyday set a treasure belongs to, and how much of it is in the box */
export function setProgress(id: string, found: (id: string) => boolean) {
  const set = TREASURE_SETS.find((s) => !s.theme && s.ids.includes(id));
  return set ? { name: set.name, have: set.ids.filter(found).length, total: set.ids.length } : undefined;
}

/**
 * What "심기" buries: the pinned treasure when it is plantable; otherwise the missing
 * treasure whose set is closest to complete (the next pad's own first), else any.
 */
export function seekPick(c: Pick<OfferContext, "nextBase" | "found" | "pinned" | "rand">): BeadType | undefined {
  const missing = HIDDEN_TYPES.filter((t) => !c.found(t.id));
  if (!missing.length) return undefined;
  const pinned = c.pinned ? missing.find((t) => t.id === c.pinned) : undefined;
  if (pinned) return pinned;
  const pool = new Set((HIDDEN_POOLS[c.nextBase] ?? []).map((e) => e.id));
  const closeness = (t: BeadType) => {
    const p = setProgress(t.id, c.found);
    return p ? (p.have + 1) / p.total : 0;
  };
  const best = Math.max(...missing.map(closeness));
  const top = missing.filter((t) => closeness(t) === best);
  const own = top.filter((t) => pool.has(t.id));
  const from = own.length ? own : top;
  return from[Math.floor((c.rand ?? Math.random)() * from.length) % from.length];
}

/** the seek door's line – a ticket can arrive while the door is on screen (a share), so it is redrawn */
export function seekTitle(name: string, pinned: boolean, free: boolean) {
  return `${pinned ? "📍 " : ""}${free ? "심기권으로" : "광고 보고"} ${name} 심기`;
}

export function pickOffer(c: OfferContext): Offer {
  if (c.nextTier === "super") return { kind: "rare", title: "광고 보고 잡기", sub: "초희귀 패드 · 초희귀 보물 확정" };
  if (c.nextTier === "rare") return { kind: "rare", title: "광고 보고 잡기", sub: "희귀 패드 · 보물 확정 · 희귀 비즈 여럿" };
  if (!c.hadTreasure && !c.bonus) {
    const isNew = !!c.dig && !c.found(c.dig.id);
    return {
      kind: "dig",
      title: "광고 보고 한 번 더 파기",
      sub: !c.dig ? "보물 하나 묻힌 작은 패드" : isNew ? "처음 보는 보물 하나 확정" : `${c.dig.name} 하나 확정`,
      digId: c.dig?.id,
      digNew: isNew,
    };
  }
  const t = seekPick(c);
  const tickets = c.tickets ?? 0;
  const pinned = !!t && t.id === c.pinned;
  // a pin or a ticket always gets its door; otherwise seek and choose take turns
  if (t && (pinned || tickets > 0 || c.totalCompleted % 2 === 1)) {
    const set = setProgress(t.id, c.found);
    const sub = !set ? "다음 패드에 묻어 둘게" : set.have + 1 === set.total ? `${set.name} 세트 완성!` : `${set.name} 세트 ${set.have}/${set.total} → ${set.have + 1}/${set.total}`;
    const free = tickets > 0;
    return {
      kind: "seek",
      title: seekTitle(t.name, pinned, free),
      sub,
      seekId: t.id,
      seekName: t.name,
      pinned,
      free,
    };
  }
  return { kind: "choose", title: "광고 보고 다른 패드로", sub: "누르면 그 패드가 열려" };
}

/**
 * Local counters for judging the doors: how often each was offered, taken and
 * actually earned. Read in the console as `__ssokAds`. No network, no identity.
 */
const STATS_KEY = "ssok.adstats.v1";
export type OfferStat = "offered" | "taken" | "earned";
export class OfferStats {
  private data: Record<OfferStat, Record<string, number>> = { offered: {}, taken: {}, earned: {} };
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined) {
    try {
      this.storage ??= localStorage;
      const raw = this.storage.getItem(STATS_KEY);
      const o = raw ? JSON.parse(raw) : null;
      for (const stat of ["offered", "taken", "earned"] as const) {
        const v = o?.[stat];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const [k, n] of Object.entries(v)) if (Number.isFinite(n)) this.data[stat][k] = n as number;
        }
      }
    } catch {
      /* private mode: counters stay in memory */
    }
  }
  note(stat: OfferStat, kind: string) {
    this.data[stat][kind] = (this.data[stat][kind] ?? 0) + 1;
    try {
      this.storage?.setItem(STATS_KEY, JSON.stringify(this.data));
    } catch {
      /* optional */
    }
  }
  get snapshot() {
    return JSON.parse(JSON.stringify(this.data)) as typeof this.data;
  }
}

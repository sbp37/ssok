import type { BeadType } from "../beads/BeadTypes";
import { HIDDEN_TYPES } from "../beads/BeadTypes";
import { HIDDEN_POOLS } from "../rewards/rates";

/**
 * The one optional rewarded-ad door on the completion screen. Every emptied
 * pad offers exactly one of these – never a row of "광고 보기" buttons – and
 * the reward is always more pulling, never a currency:
 *
 *  rare    the passing variant (existing door): catch it instead of the plain pad
 *  dig     this pad hid nothing → a small bonus pad with one treasure for sure
 *  seek    a treasure still missing from the box is buried in the next pad
 *  choose  pick the next pad from three, shown in their real colours
 */
export type OfferKind = "rare" | "dig" | "seek" | "choose";

export interface Offer {
  kind: OfferKind;
  /** button line, e.g. "광고 보고 잡기" */
  title: string;
  /** small line under it: what you get */
  sub: string;
  /** seek only: the treasure to bury */
  seekId?: string;
  seekName?: string;
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
  rand?: () => number;
}

/** hidden (non-ultra) treasures not yet in the box, the next pad's own first */
export function seekCandidates(nextBase: string, found: (id: string) => boolean): BeadType[] {
  const pool = new Set((HIDDEN_POOLS[nextBase] ?? []).map((e) => e.id));
  const missing = HIDDEN_TYPES.filter((t) => !found(t.id));
  const own = missing.filter((t) => pool.has(t.id));
  return own.length ? own : missing;
}

export function pickOffer(c: OfferContext): Offer {
  if (c.nextTier === "super") return { kind: "rare", title: "광고 보고 잡기", sub: "초희귀 패드 · 초희귀 보물 확정" };
  if (c.nextTier === "rare") return { kind: "rare", title: "광고 보고 잡기", sub: "희귀 패드 · 보물 확정 · 희귀 비즈 여럿" };
  if (!c.hadTreasure && !c.bonus) return { kind: "dig", title: "광고 보고 한 번 더 파기", sub: "보물 하나 묻힌 작은 패드" };
  const seek = seekCandidates(c.nextBase, c.found);
  if (seek.length && c.totalCompleted % 2 === 1) {
    const t = seek[Math.floor((c.rand ?? Math.random)() * seek.length)];
    return { kind: "seek", title: `광고 보고 ${t.name} 심기`, sub: "다음 패드에 묻어 둘게", seekId: t.id, seekName: t.name };
  }
  return { kind: "choose", title: "광고 보고 다음 패드 고르기", sub: "셋 중 하나" };
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

import { Promotion } from "@apps-in-toss/web-framework";

export type PromotionMilestone = "firstPad" | "thirdPad" | "fifthPad" | "tenthPad" | "returnVisit";

const TEST_CODES: Record<PromotionMilestone, string> = {
  firstPad: "TEST_01M2G7DZXEHF60PHHQ6ZA5342T",
  thirdPad: "TEST_01M2G7F5WHW5HD8KWP1JRSFYYS",
  fifthPad: "TEST_01M3PRX7ZP8GAM2HZ9Z7NQ31KT",
  tenthPad: "TEST_01M3PS0C2YGKRKPC98FW37NSTZ",
  returnVisit: "TEST_01M2G7GN8PMTXBNVJWJXJ2V8MH",
};

const LIVE_CODES: Record<PromotionMilestone, string> = {
  firstPad: "01M2G7DZXEHF60PHHQ6ZA5342T",
  thirdPad: "01M2G7F5WHW5HD8KWP1JRSFYYS",
  fifthPad: "01M3PRX7ZP8GAM2HZ9Z7NQ31KT",
  tenthPad: "01M3PS0C2YGKRKPC98FW37NSTZ",
  returnVisit: "01M2G7GN8PMTXBNVJWJXJ2V8MH",
};

const LIVE_MODE = import.meta.env.VITE_PROMOTION_MODE === "live";
const ACTIVE_CODES: Record<PromotionMilestone, string> = LIVE_MODE ? LIVE_CODES : TEST_CODES;

const AMOUNTS: Record<PromotionMilestone, number> = {
  firstPad: 1,
  thirdPad: 3,
  fifthPad: 5,
  tenthPad: 10,
  returnVisit: 2,
};

const STORAGE_KEY = "ssok.promotions.v1";
const MILESTONES: readonly PromotionMilestone[] = ["firstPad", "thirdPad", "fifthPad", "tenthPad", "returnVisit"];

/** Toss answers that say for sure nothing was paid (missing, paused or out of money, an internal
 * refusal): safe to ask again on a later visit. */
const NOT_PAID = new Set(["40000", "4100", "4109", "4110", "4112", "4114", "4116"]);
/** Any other outcome – an unknown error, an odd reply, or no reply because the app closed –
 * may still have paid (the SDK warns that repeated calls can pay twice), so a code is asked
 * at most this many times in all unless Toss said it was not paid. */
export const MAX_UNSURE = 3;

interface SavedPromotionState {
  granted: string[];
  /** milestones reached but not paid yet – asked again on the next visit and pad */
  pending?: PromotionMilestone[];
  /** failures that might have paid anyway, per code */
  unsure?: Record<string, number>;
}

/**
 * Client-side promotion bridge for the Apps-in-Toss non-game miniapp.
 *
 * The test bundle uses TEST_ codes by default. A release build must explicitly
 * set VITE_PROMOTION_MODE=live, which makes an accidental live payout from a
 * local or QA build much less likely.
 */
export class PromotionRewards {
  readonly mode = LIVE_MODE ? "live" : "test";
  private granted = new Set<string>();
  private pending = new Set<PromotionMilestone>();
  private unsure: Record<string, number> = {};
  private inFlight = new Set<PromotionMilestone>();
  /** failed in this session: asked again on the next start, not after every pad (Toss allows
   * 10 calls a minute per user, and an empty budget would otherwise be asked at every pad) */
  private failedNow = new Set<PromotionMilestone>();

  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined) {
    try {
      this.storage ??= localStorage;
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY) || "null") as SavedPromotionState | null;
      for (const code of saved?.granted ?? []) if (typeof code === "string") this.granted.add(code);
      for (const m of saved?.pending ?? []) if (MILESTONES.includes(m)) this.pending.add(m);
      for (const [code, n] of Object.entries(saved?.unsure ?? {})) if (Number.isFinite(n) && n > 0) this.unsure[code] = Math.floor(n);
    } catch {
      // Private browsing or malformed local data must never block the game.
    }
  }

  private save() {
    try {
      const state: SavedPromotionState = { granted: [...this.granted], pending: [...this.pending], unsure: this.unsure };
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Persistence is best-effort; the Toss API still validates the request.
    }
  }

  async grant(milestone: PromotionMilestone): Promise<boolean> {
    const code = ACTIVE_CODES[milestone];
    if (this.granted.has(code) || this.inFlight.has(milestone) || this.failedNow.has(milestone)) return false;
    if ((this.unsure[code] ?? 0) >= MAX_UNSURE) return false;
    try {
      if (!Promotion.grantReward.isSupported()) return false;
    } catch {
      return false;
    }

    this.inFlight.add(milestone);
    // counted as unsure before asking: a request cut off by closing the app may still have paid
    this.unsure[code] = (this.unsure[code] ?? 0) + 1;
    this.save();
    try {
      const result = await Promotion.grantReward({ promotionCode: code, amount: AMOUNTS[milestone] });
      if (!result?.key) {
        this.failedNow.add(milestone);
        return false;
      }
      this.granted.add(code);
      this.pending.delete(milestone);
      this.save();
      return true;
    } catch (error) {
      const failure = String((error as { code?: unknown } | null)?.code ?? "");
      this.failedNow.add(milestone);
      if (NOT_PAID.has(failure)) {
        // Toss says for sure nothing was paid: this try does not count against the cap
        if (--this.unsure[code] <= 0) delete this.unsure[code];
        this.save();
      }
      console.warn(`[ssok] promotion ${milestone} was not granted`, error);
      return false;
    } finally {
      this.inFlight.delete(milestone);
    }
  }

  /** a milestone was reached: remember it until it is paid, then ask */
  private reach(milestone: PromotionMilestone) {
    if (this.granted.has(ACTIVE_CODES[milestone])) return;
    if (!this.pending.has(milestone)) {
      this.pending.add(milestone);
      this.save();
    }
    void this.grant(milestone);
  }

  /** ask again for everything reached but not paid (a failure, or the app closed mid-request) */
  retryPending() {
    for (const milestone of this.pending) void this.grant(milestone);
  }

  onPadCompleted(totalCompleted: number) {
    if (totalCompleted >= 1) this.reach("firstPad");
    if (totalCompleted >= 3) this.reach("thirdPad");
    if (totalCompleted >= 5) this.reach("fifthPad");
    if (totalCompleted >= 10) this.reach("tenthPad");
    this.retryPending();
  }

  /** each start (and each midnight the game stays open across) – a return visit is kept
   * until it is paid, so a failure is retried the same day, not only on the next one */
  onVisit(isNewDay: boolean, totalCompleted: number) {
    if (isNewDay && totalCompleted > 0) this.reach("returnVisit");
    this.retryPending();
  }

  /** TEST_ codes only: lets one mobile AIT link verify all three SDK calls. */
  async runTestMilestones() {
    const granted: PromotionMilestone[] = [];
    if (this.mode !== "test") return granted;
    for (const milestone of ["firstPad", "thirdPad", "returnVisit"] as const) {
      if (await this.grant(milestone)) granted.push(milestone);
    }
    return granted;
  }
}

import { Promotion } from "@apps-in-toss/web-framework";

export type PromotionMilestone = "firstPad" | "thirdPad" | "returnVisit";

const TEST_CODES: Record<PromotionMilestone, string> = {
  firstPad: "TEST_01M2G7DZXEHF60PHHQ6ZA5342T",
  thirdPad: "TEST_01M2G7F5WHW5HD8KWP1JRSFYYS",
  returnVisit: "TEST_01M2G7GN8PMTXBNVJWJXJ2V8MH",
};

const LIVE_CODES: Record<PromotionMilestone, string> = {
  firstPad: "01M2G7DZXEHF60PHHQ6ZA5342T",
  thirdPad: "01M2G7F5WHW5HD8KWP1JRSFYYS",
  returnVisit: "01M2G7GN8PMTXBNVJWJXJ2V8MH",
};

const AMOUNTS: Record<PromotionMilestone, number> = {
  firstPad: 1,
  thirdPad: 3,
  returnVisit: 2,
};

const STORAGE_KEY = "ssok.promotions.v1";

interface SavedPromotionState {
  granted: string[];
}

/**
 * Client-side promotion bridge for the Apps-in-Toss non-game miniapp.
 *
 * The test bundle uses TEST_ codes by default. A release build must explicitly
 * set VITE_PROMOTION_MODE=live, which makes an accidental live payout from a
 * local or QA build much less likely.
 */
export class PromotionRewards {
  readonly mode = import.meta.env.VITE_PROMOTION_MODE === "live" ? "live" : "test";
  private granted = new Set<string>();
  private inFlight = new Set<PromotionMilestone>();

  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined) {
    try {
      this.storage ??= localStorage;
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY) || "null") as SavedPromotionState | null;
      for (const code of saved?.granted ?? []) this.granted.add(code);
    } catch {
      // Private browsing or malformed local data must never block the game.
    }
  }

  private get codes() {
    return this.mode === "live" ? LIVE_CODES : TEST_CODES;
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ granted: [...this.granted] }));
    } catch {
      // Persistence is best-effort; the Toss API still validates the request.
    }
  }

  async grant(milestone: PromotionMilestone): Promise<boolean> {
    const code = this.codes[milestone];
    if (this.granted.has(code) || this.inFlight.has(milestone)) return false;
    try {
      if (!Promotion.grantReward.isSupported()) return false;
    } catch {
      return false;
    }

    this.inFlight.add(milestone);
    try {
      const result = await Promotion.grantReward({ promotionCode: code, amount: AMOUNTS[milestone] });
      if (!result?.key) return false;
      this.granted.add(code);
      this.save();
      return true;
    } catch (error) {
      console.warn(`[ssok] promotion ${milestone} was not granted`, error);
      return false;
    } finally {
      this.inFlight.delete(milestone);
    }
  }

  onPadCompleted(totalCompleted: number) {
    if (totalCompleted >= 1) void this.grant("firstPad");
    if (totalCompleted >= 3) void this.grant("thirdPad");
  }

  onVisit(isNewDay: boolean, totalCompleted: number) {
    if (isNewDay && totalCompleted > 0) void this.grant("returnVisit");
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

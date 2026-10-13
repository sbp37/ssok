import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

export const AD_INTERVAL_PADS = 1;
/** completed pads before the first interstitial: the opening pads are ad-free */
export const FREE_PADS = 2;
/** at least this long since the last full-screen ad (interstitial OR rewarded) before an interstitial */
export const MIN_GAP_MS = 75_000;
const KEY = "ssok.ads.v1";

/**
 * Live ad groups only in the release bundle (`pnpm toss:build:live`). Every
 * other build – dev, QA, the AIT test push – uses Toss's test groups, because
 * testing against a live group is a policy violation.
 */
export const LIVE_ADS = import.meta.env.VITE_PROMOTION_MODE === "live";
export type AdKind = "interstitial" | "rewarded";
export const AD_GROUP_IDS: Record<AdKind | "banner", string> = LIVE_ADS
  ? {
      interstitial: "ait.v2.live.fd15b48eec824769",
      rewarded: "ait.v2.live.9a6ebffe05904cda",
      banner: "ait.v2.live.fa7e951585b7468c",
    }
  : {
      interstitial: "ait-ad-test-interstitial-id",
      rewarded: "ait-ad-test-rewarded-id",
      banner: "ait-ad-test-banner-id",
    };
export type AdResult = "closed" | "rewarded" | "unavailable";

export interface AdProvider {
  /** Must be synchronous: preload elsewhere; never wait for fill at NEXT. */
  ready(kind: AdKind): boolean;
  /** Resolve after dismissal. Abort must close/remove the provider overlay.
   * Only the SDK's earned-reward callback may produce `rewarded`. `onOpen` is
   * called once the ad is actually on screen: from then on only its dismissal ends it. */
  show(kind: AdKind, signal: AbortSignal, onOpen?: () => void): Promise<AdResult>;
  destroy?(): void;
}

/** Retains the existing simulated variant unlock; ordinary NEXT has no fake ad. */
export class MockAdProvider implements AdProvider {
  ready(kind: AdKind) { return kind === "rewarded"; }
  async show(kind: AdKind, signal: AbortSignal): Promise<AdResult> {
    return signal.aborted || kind === "interstitial" ? "unavailable" : "rewarded";
  }
}

/** Apps-in-Toss full-screen ads. One loaded ad is kept ready for each group. */
export class TossAdProvider implements AdProvider {
  private loaded: Record<AdKind, boolean> = { interstitial: false, rewarded: false };
  private loading: Record<AdKind, boolean> = { interstitial: false, rewarded: false };
  private unregisterLoad: Partial<Record<AdKind, () => void>> = {};
  private retryTimers: Partial<Record<AdKind, ReturnType<typeof setTimeout>>> = {};
  private destroyed = false;

  static supported() {
    try {
      return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
    } catch {
      return false;
    }
  }

  constructor() {
    this.load("interstitial");
    this.load("rewarded");
  }

  private load(kind: AdKind) {
    if (this.destroyed || this.loaded[kind] || this.loading[kind] || !TossAdProvider.supported()) return;
    this.loading[kind] = true;
    this.unregisterLoad[kind]?.();
    try {
      this.unregisterLoad[kind] = loadFullScreenAd({
        options: { adGroupId: AD_GROUP_IDS[kind] },
        onEvent: (event) => {
          if (event.type !== "loaded" || this.destroyed) return;
          this.loading[kind] = false;
          this.loaded[kind] = true;
          this.unregisterLoad[kind]?.();
          delete this.unregisterLoad[kind];
        },
        onError: () => {
          this.loading[kind] = false;
          this.unregisterLoad[kind]?.();
          delete this.unregisterLoad[kind];
          this.retry(kind);
        },
      });
    } catch {
      this.loading[kind] = false;
      this.retry(kind);
    }
  }

  private retry(kind: AdKind) {
    if (this.destroyed || this.retryTimers[kind]) return;
    this.retryTimers[kind] = setTimeout(() => {
      delete this.retryTimers[kind];
      this.load(kind);
    }, 15_000);
  }

  ready(kind: AdKind) {
    if (!this.loaded[kind]) this.load(kind);
    return this.loaded[kind];
  }

  show(kind: AdKind, signal: AbortSignal, onOpen?: () => void): Promise<AdResult> {
    if (!this.loaded[kind] || signal.aborted) return Promise.resolve("unavailable");
    this.loaded[kind] = false;
    return new Promise((resolve) => {
      let earned = false;
      let settled = false;
      let unregister = () => {};
      const finish = (result: AdResult) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        unregister();
        this.load(kind);
        resolve(result);
      };
      const onAbort = () => finish("unavailable");
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        unregister = showFullScreenAd({
          options: { adGroupId: AD_GROUP_IDS[kind] },
          onEvent: (event) => {
            if (event.type === "show" || event.type === "impression") onOpen?.();
            if (event.type === "userEarnedReward") earned = true;
            else if (event.type === "dismissed") finish(kind === "rewarded" && earned ? "rewarded" : "closed");
            else if (event.type === "failedToShow") finish("unavailable");
          },
          onError: () => finish("unavailable"),
        });
      } catch {
        finish("unavailable");
      }
    });
  }

  destroy() {
    this.destroyed = true;
    (Object.keys(this.unregisterLoad) as AdKind[]).forEach((kind) => this.unregisterLoad[kind]?.());
    (Object.keys(this.retryTimers) as AdKind[]).forEach((kind) => clearTimeout(this.retryTimers[kind]));
    this.unregisterLoad = {};
    this.retryTimers = {};
  }
}

export function createAdProvider(): AdProvider {
  return TossAdProvider.supported() ? new TossAdProvider() : new MockAdProvider();
}

export class AdPolicy {
  private lastAdCompleted = 0;
  /** wall clock of the last full-screen ad that was actually shown */
  private lastAdAt = 0;
  private busy = false;
  private active: AbortController | null = null;
  constructor(
    public provider: AdProvider = new MockAdProvider(),
    private now = () => Date.now(),
    private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined,
    private timeoutMs = 60_000,
  ) {
    try {
      this.storage ??= localStorage;
      const saved = JSON.parse(this.storage.getItem(KEY) || "null");
      if (Number.isFinite(saved?.lastAdCompleted) && saved.lastAdCompleted >= 0) {
        this.lastAdCompleted = Math.floor(saved.lastAdCompleted);
      }
      if (Number.isFinite(saved?.lastAdAt) && saved.lastAdAt > 0 && saved.lastAdAt <= this.now()) {
        this.lastAdAt = saved.lastAdAt;
      }
    } catch { /* private mode / invalid storage must not block play */ }
  }
  private save() {
    try { this.storage?.setItem(KEY, JSON.stringify({lastAdCompleted: this.lastAdCompleted, lastAdAt: this.lastAdAt})); } catch { /* optional persistence */ }
  }
  /** The opening pads are ad-free; after them a transition is eligible when no
   * full-screen ad was shown for this completion and none in the last MIN_GAP_MS. */
  eligible(totalCompleted: number) {
    return totalCompleted >= FREE_PADS
      && totalCompleted - this.lastAdCompleted >= AD_INTERVAL_PADS
      && this.now() - this.lastAdAt >= MIN_GAP_MS;
  }
  /** the player already tried a rewarded door for this completion (it failed):
   * the plain NEXT of the same transition must not add an interstitial on top */
  waive(totalCompleted: number) {
    this.lastAdCompleted = Math.max(this.lastAdCompleted, totalCompleted);
    this.save();
  }
  /** is a full-screen ad of this kind loaded right now (never waits) */
  ready(kind: AdKind) {
    try {
      return this.provider.ready(kind);
    } catch {
      return false;
    }
  }
  cancel() {
    this.active?.abort();
    this.provider.destroy?.();
  }
  /** null = duplicate/cancelled transition; caller must not open a second pad. */
  async next(kind: AdKind, totalCompleted: number): Promise<AdResult | null> {
    if (this.busy) return null;
    this.busy = true;
    const abort = new AbortController();
    this.active = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (kind === "interstitial") {
        if (!this.eligible(totalCompleted)) return "unavailable";
      }
      if (!this.provider.ready(kind)) return "unavailable";
      // The watchdog only covers an ad that never opens. Once it is on screen,
      // cutting it short would resume the game under it – and could drop a reward
      // the player already earned – so from then on only its dismissal ends it.
      const interrupted = new Promise<AdResult>((resolve) => {
        abort.signal.addEventListener("abort", () => resolve("unavailable"), {once: true});
        timer = setTimeout(() => abort.abort(), this.timeoutMs);
      });
      const opened = () => clearTimeout(timer);
      const result = await Promise.race([this.provider.show(kind, abort.signal, opened), interrupted]);
      if (result === "closed" || result === "rewarded") {
        this.lastAdCompleted = Math.max(this.lastAdCompleted, totalCompleted);
        this.lastAdAt = this.now();
        this.save();
      }
      return result;
    } catch { return "unavailable"; }
    finally {
      clearTimeout(timer);
      this.active = null;
      this.busy = false;
    }
  }
}

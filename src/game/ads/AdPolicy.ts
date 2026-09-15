import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

export const AD_INTERVAL_MS = 120_000;
const KEY = "ssok.ads.v1";
const AD_GROUP_IDS: Record<AdKind, string> = {
  interstitial: "ait.v2.live.fd15b48eec824769",
  rewarded: "ait.v2.live.9a6ebffe05904cda",
};
export type AdKind = "interstitial" | "rewarded";
export type AdResult = "closed" | "rewarded" | "unavailable";

export interface AdProvider {
  /** Must be synchronous: preload elsewhere; never wait for fill at NEXT. */
  ready(kind: AdKind): boolean;
  /** Resolve after dismissal. Abort must close/remove the provider overlay.
   * Only the SDK's earned-reward callback may produce `rewarded`. */
  show(kind: AdKind, signal: AbortSignal): Promise<AdResult>;
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

  show(kind: AdKind, signal: AbortSignal): Promise<AdResult> {
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
  private lastAdAt = 0;
  private skipNext = false;
  private busy = false;
  private active: AbortController | null = null;
  private startedAt: number;
  constructor(
    public provider: AdProvider = new MockAdProvider(),
    private now = () => Date.now(),
    private storage: Pick<Storage, "getItem" | "setItem"> | undefined = undefined,
    private timeoutMs = 60_000,
  ) {
    this.startedAt = now();
    try {
      this.storage ??= localStorage;
      const saved = JSON.parse(this.storage.getItem(KEY) || "null");
      if (Number.isFinite(saved?.lastAdAt) && saved.lastAdAt >= 0) this.lastAdAt = Math.min(saved.lastAdAt, now());
      this.skipNext = saved?.skipNext === true;
    } catch { /* private mode / invalid storage must not block play */ }
  }
  private save() {
    try { this.storage?.setItem(KEY, JSON.stringify({lastAdAt: this.lastAdAt, skipNext: this.skipNext})); } catch { /* optional persistence */ }
  }
  /** Lifetime first completion is free. Each new visit also gets a 2-minute grace period. */
  eligible(totalCompleted: number) {
    return totalCompleted > 1 && !this.skipNext && this.now() - Math.max(this.startedAt, this.lastAdAt) >= AD_INTERVAL_MS;
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
        if (this.skipNext) { this.skipNext = false; this.save(); return "unavailable"; }
        if (!this.eligible(totalCompleted)) return "unavailable";
      }
      if (!this.provider.ready(kind)) return "unavailable";
      const interrupted = new Promise<AdResult>((resolve) => {
        abort.signal.addEventListener("abort", () => resolve("unavailable"), {once: true});
        timer = setTimeout(() => abort.abort(), this.timeoutMs);
      });
      const result = await Promise.race([this.provider.show(kind, abort.signal), interrupted]);
      if (result === "closed" || result === "rewarded") {
        this.lastAdAt = this.now();
        // Even a dismissed rewarded video must not be followed by an interstitial.
        this.skipNext = kind === "rewarded";
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

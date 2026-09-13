/** Transition policy only. No advertising SDK or network requests. */
export const AD_INTERVAL_MS = 120_000;
const KEY = "ssok.ads.v1";
export type AdKind = "interstitial" | "rewarded";
export type AdResult = "closed" | "rewarded" | "unavailable";

export interface AdProvider {
  /** Must be synchronous: preload elsewhere; never wait for fill at NEXT. */
  ready(kind: AdKind): boolean;
  /** Resolve after dismissal. Abort must close/remove the provider overlay.
   * Only the SDK's earned-reward callback may produce `rewarded`. */
  show(kind: AdKind, signal: AbortSignal): Promise<AdResult>;
}

/** Retains the existing simulated variant unlock; ordinary NEXT has no fake ad. */
export class MockAdProvider implements AdProvider {
  ready(kind: AdKind) { return kind === "rewarded"; }
  async show(kind: AdKind, signal: AbortSignal): Promise<AdResult> {
    return signal.aborted || kind === "interstitial" ? "unavailable" : "rewarded";
  }
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
  cancel() { this.active?.abort(); }
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

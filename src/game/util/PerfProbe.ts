/**
 * `?perf=1` – on-device frame timing, no dependencies. Shows a small overlay
 * with frame interval (what the player feels) and update+render work time
 * (what our code costs), as median / p95 over the last ~2 s, plus long frames.
 * Off by default: when disabled, begin/end are no-ops and nothing is allocated.
 */
const WINDOW = 120;
const REPORT_EVERY_MS = 1000;

export interface PerfReport {
  frames: number;
  fps: number;
  intervalP50: number;
  intervalP95: number;
  workP50: number;
  workP95: number;
  /** frames slower than 2 × 16.7 ms since the probe started */
  longFrames: number;
}

export class PerfProbe {
  readonly enabled: boolean;
  private intervals = new Float32Array(WINDOW);
  private work = new Float32Array(WINDOW);
  private n = 0;
  private lastFrame = 0;
  private workStart = 0;
  private lastReport = 0;
  private long = 0;
  private el: HTMLDivElement | null = null;
  last: PerfReport | null = null;

  constructor(enabled = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf")) {
    this.enabled = enabled;
  }

  begin(now: number) {
    if (!this.enabled) return;
    if (this.lastFrame) {
      const dt = now - this.lastFrame;
      this.intervals[this.n % WINDOW] = dt;
      if (dt > 33.4) this.long++;
    }
    this.lastFrame = now;
    this.workStart = performance.now();
  }

  end() {
    if (!this.enabled || !this.workStart) return;
    const now = performance.now();
    this.work[this.n % WINDOW] = now - this.workStart;
    this.n++;
    if (now - this.lastReport > REPORT_EVERY_MS && this.n > 10) {
      this.lastReport = now;
      this.last = this.report();
      this.show(this.last);
    }
  }

  report(): PerfReport {
    const count = Math.min(this.n, WINDOW);
    const pick = (src: Float32Array) => {
      const a = Array.from(src.subarray(0, count)).sort((x, y) => x - y);
      const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
      return [q(0.5), q(0.95)];
    };
    const [i50, i95] = pick(this.intervals);
    const [w50, w95] = pick(this.work);
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      frames: this.n,
      fps: i50 > 0 ? Math.round(1000 / i50) : 0,
      intervalP50: r(i50),
      intervalP95: r(i95),
      workP50: r(w50),
      workP95: r(w95),
      longFrames: this.long,
    };
  }

  private show(p: PerfReport) {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.style.cssText =
        "position:fixed;left:6px;bottom:6px;z-index:99;padding:4px 7px;border-radius:6px;" +
        "background:rgba(20,16,24,.72);color:#fff;font:11px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre";
      document.body.appendChild(this.el);
    }
    this.el.textContent =
      `${p.fps} fps · frame ${p.intervalP50}/${p.intervalP95}ms\n` + `work ${p.workP50}/${p.workP95}ms · long ${p.longFrames}`;
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }
}

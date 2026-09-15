import { Device, type HapticFeedbackType } from "@apps-in-toss/web-framework";

const KEY = "ssok.haptics";

class Haptics {
  enabled = true;
  private supported = typeof navigator !== "undefined" && "vibrate" in navigator;
  constructor() {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) this.enabled = v === "1";
    } catch {
      /* private mode etc. */
    }
  }
  setEnabled(v: boolean) {
    this.enabled = v;
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  private buzz(p: number | number[]) {
    if (!this.enabled) return;
    if (this.supported) {
      try {
        navigator.vibrate(p);
        return;
      } catch {
        /* Fall through to the Toss bridge. */
      }
    }
    const type: HapticFeedbackType = Array.isArray(p)
      ? "success"
      : p <= 5
        ? "tickWeak"
        : p <= 9
          ? "tap"
          : p <= 13
            ? "softMedium"
            : "basicMedium";
    void Device.triggerHaptic({ type }).catch(() => {
      /* Normal browsers and older Toss versions may not expose the bridge. */
    });
  }
  press() {
    this.buzz(5);
  }
  slipStart() {
    this.buzz(4);
  }
  /** a big bead wedged: a firm little bump */
  jam() {
    this.buzz(7);
  }
  /** …and gave way */
  give() {
    this.buzz(10);
  }
  pop(mass: number) {
    this.buzz(Math.round(12 + Math.min(6, mass * 3)));
  }
  rare() {
    this.buzz([10, 40, 20]);
  }
  slipped() {
    this.buzz(8);
  }
}

export const haptics = new Haptics();

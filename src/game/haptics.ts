import { Device, Environment, type HapticFeedbackType } from "@apps-in-toss/web-framework";
import type { TactileKind } from "./fibers/Tactile";

const KEY = "ssok.haptics";

class Haptics {
  enabled = true;
  private supported = typeof navigator !== "undefined" && "vibrate" in navigator;
  private inToss = false;
  constructor() {
    try { this.inToss = Environment.environment === "toss" || Environment.environment === "sandbox"; } catch { /* browser */ }
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
  private buzz(p: number | number[], type?: HapticFeedbackType) {
    if (!this.enabled) return;
    const nativeType: HapticFeedbackType = type ?? (Array.isArray(p)
      ? "success"
      : p <= 5 ? "tickWeak" : p <= 9 ? "tap" : p <= 13 ? "softMedium" : "basicMedium");
    // In Toss use its native bridge first: navigator.vibrate may exist in a
    // WebView yet silently do nothing. Never play both paths simultaneously.
    if (this.inToss) {
      void Device.triggerHaptic({ type: nativeType }).catch(() => {
        if (this.supported) try { navigator.vibrate(p); } catch { /* unsupported */ }
      });
      return;
    }
    if (this.supported) {
      try {
        if (navigator.vibrate(p)) return;
      } catch {
        /* Unsupported browser. */
      }
    }
  }
  tactileStep(kind: TactileKind) {
    const type: HapticFeedbackType = kind === "charm" || kind === "bubble" ? "tap" : kind === "swirl" || kind === "fiber" ? "softMedium" : "tickMedium";
    this.buzz(kind === "charm" || kind === "bubble" ? 8 : 6, type);
  }
  tactilePop(kind: TactileKind) {
    this.buzz(kind === "charm" ? [15, 24, 22] : 16, kind === "charm" ? "success" : "basicMedium");
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

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
    if (!this.enabled || !this.supported) return;
    try {
      navigator.vibrate(p);
    } catch {
      /* ignore */
    }
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

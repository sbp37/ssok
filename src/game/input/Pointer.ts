/**
 * Pointer input with a short velocity history (px/s). Touch first, mouse works.
 */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

type Handler = (p: PointerSample) => void;

export class PointerInput {
  private hist = new Map<number, { t: number; x: number; y: number }[]>();
  onDown: Handler = () => {};
  onMove: Handler = () => {};
  onUp: Handler = () => {};

  constructor(private el: HTMLElement) {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.down, { passive: false });
    el.addEventListener("pointermove", this.move, { passive: false });
    el.addEventListener("pointerup", this.up, { passive: false });
    el.addEventListener("pointercancel", this.up, { passive: false });
    el.addEventListener("lostpointercapture", this.up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  destroy() {
    const el = this.el;
    el.removeEventListener("pointerdown", this.down);
    el.removeEventListener("pointermove", this.move);
    el.removeEventListener("pointerup", this.up);
    el.removeEventListener("pointercancel", this.up);
    el.removeEventListener("lostpointercapture", this.up);
  }

  private local(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private sample(e: PointerEvent): PointerSample {
    const { x, y } = this.local(e);
    const now = performance.now();
    let h = this.hist.get(e.pointerId);
    if (!h) {
      h = [];
      this.hist.set(e.pointerId, h);
    }
    h.push({ t: now, x, y });
    while (h.length > 1 && now - h[0].t > 70) h.shift();
    let vx = 0,
      vy = 0;
    if (h.length > 1) {
      const a = h[0];
      const dt = (now - a.t) / 1000;
      if (dt > 0.004) {
        vx = (x - a.x) / dt;
        vy = (y - a.y) / dt;
      }
    }
    return { id: e.pointerId, x, y, vx, vy, speed: Math.hypot(vx, vy) };
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.hist.delete(e.pointerId);
    this.onDown(this.sample(e));
  };
  private move = (e: PointerEvent) => {
    if (!this.hist.has(e.pointerId)) return;
    e.preventDefault();
    // coalesced events give finer velocity on Android
    const evs = (e.getCoalescedEvents?.() ?? []) as PointerEvent[];
    if (evs.length > 1) for (const ce of evs.slice(0, -1)) this.sample(ce);
    this.onMove(this.sample(e));
  };
  private up = (e: PointerEvent) => {
    if (!this.hist.has(e.pointerId)) return;
    const s = this.sample(e);
    this.hist.delete(e.pointerId);
    this.onUp(s);
  };
}

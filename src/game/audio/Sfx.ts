import type { BeadMaterial, PopSound } from "../beads/BeadTypes";

/**
 * All sound is procedural (Web Audio) – no files to load, and every hit is
 * re-synthesised with ±5~10% pitch/level jitter so nothing ever repeats
 * exactly. Kept close-mic'd and quiet, ASMR-ish rather than arcade.
 */
const KEY = "ssok.sound";

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  constructor() {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) this.enabled = v === "1";
    } catch {
      /* ignore */
    }
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.value = v ? 0.55 : 0;
  }

  /** Must be called from a user gesture once. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC({ latencyHint: "interactive" });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.55 : 0;
        // gentle limiter so overlapping pops never clip
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 20;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.08;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  private get ready() {
    return !!this.ctx && !!this.master && this.enabled && this.ctx.state === "running";
  }
  private j(pct = 0.08) {
    return 1 + (Math.random() * 2 - 1) * pct;
  }

  // ─── building blocks ──────────────────────────────────────────
  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    opts: { attack?: number; curve?: number; delay?: number; filter?: number } = {},
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.filter;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(
    dur: number,
    gain: number,
    opts: { type?: BiquadFilterType; freq?: number; freq1?: number; q?: number; delay?: number; attack?: number } = {},
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    src.playbackRate.value = this.j(0.1);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.setValueAtTime(opts.freq ?? 1500, t);
    if (opts.freq1) f.frequency.exponentialRampToValueAtTime(opts.freq1, t + dur);
    f.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (opts.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.02);
  }

  // ─── game sounds ──────────────────────────────────────────────
  /** finger lands on the gel: tiny viscous "뭉" */
  press() {
    if (!this.ready) return;
    this.burst(0.09 * this.j(0.15), 0.05 * this.j(0.2), { type: "lowpass", freq: 700, q: 0.7, attack: 0.01 });
    this.tone("sine", 95 * this.j(0.1), 60, 0.07, 0.035);
  }

  /** gel starting to give: faint sticky "찌익" */
  stretch(mass: number) {
    if (!this.ready) return;
    this.burst(0.12 * this.j(0.15), 0.028 * this.j(0.2), {
      type: "bandpass",
      freq: 320 / Math.sqrt(mass),
      freq1: 900 / Math.sqrt(mass),
      q: 2.5,
      attack: 0.03,
    });
  }

  /** stick-slip "딱… 딱…" as the bead creeps out */
  tick(mass: number, step: number) {
    if (!this.ready) return;
    const f = (2600 + step * 180) / Math.pow(mass, 0.35);
    this.burst(0.018, 0.045 * this.j(0.2), { type: "bandpass", freq: f * this.j(0.08), q: 4 });
    this.tone("sine", f * 0.5 * this.j(0.08), f * 0.35, 0.025, 0.02);
  }

  pop(kind: PopSound, mass: number, rare = false) {
    if (!this.ready) return;
    const m = Math.pow(mass, 0.45);
    const jp = this.j(0.08);
    const jv = this.j(0.1);
    switch (kind) {
      case "pok": // 뽁 – round, bubbly
        this.tone("sine", (880 / m) * jp, (330 / m) * jp, 0.085, 0.42 * jv, { attack: 0.002 });
        this.burst(0.025, 0.12 * jv, { freq: 1800 / m, q: 1 });
        break;
      case "ssok": // 쏙 – airy suction then pitch drop
        this.burst(0.045, 0.14 * jv, { type: "highpass", freq: 1600, q: 0.7, attack: 0.004 });
        this.tone("sine", (760 / m) * jp, (260 / m) * jp, 0.075, 0.36 * jv, { delay: 0.012 });
        break;
      case "pong": // 퐁 – big, hollow
        this.tone("sine", (520 / m) * jp, (210 / m) * jp, 0.19, 0.5 * jv, { attack: 0.004 });
        this.tone("triangle", (1040 / m) * jp, (400 / m) * jp, 0.08, 0.12 * jv);
        this.burst(0.04, 0.1 * jv, { type: "lowpass", freq: 1400, q: 0.8 });
        break;
      case "tok": // 톡 – short, hard
        this.burst(0.022, 0.2 * jv, { freq: (3200 / m) * jp, q: 2.5 });
        this.tone("sine", (1400 / m) * jp, (700 / m) * jp, 0.045, 0.3 * jv);
        break;
      case "ting": // 띵 ✦ – small bell
        this.tone("sine", 1568 * jp, 1560 * jp, 0.7, 0.28 * jv, { attack: 0.003 });
        this.tone("sine", 3136 * jp, 3130 * jp, 0.45, 0.09 * jv, { attack: 0.003 });
        this.tone("sine", 2349 * jp, 2345 * jp, 0.35, 0.06 * jv, { attack: 0.003, delay: 0.015 });
        this.burst(0.03, 0.1 * jv, { type: "highpass", freq: 2500 });
        break;
    }
    if (rare && kind !== "ting") {
      this.tone("sine", 2093 * jp, 2090 * jp, 0.5, 0.15 * jv, { delay: 0.04 });
    }
  }

  /** bead lands in the collector */
  land(material: BeadMaterial, mass: number) {
    if (!this.ready) return;
    const m = Math.pow(mass, 0.4);
    const jp = this.j(0.09);
    const jv = this.j(0.12);
    switch (material) {
      case "glass": // 챙/띵 glassy
        this.tone("sine", (2700 / m) * jp, (2650 / m) * jp, 0.22, 0.17 * jv, { attack: 0.001 });
        this.tone("sine", (7400 / m) * jp, (7300 / m) * jp, 0.09, 0.05 * jv, { attack: 0.001 });
        break;
      case "metal": // 챙
        [1, 1.5, 2.43].forEach((k, i) =>
          this.tone("sine", (2200 * k) / m * jp, (2180 * k) / m * jp, 0.4 - i * 0.1, (0.13 - i * 0.035) * jv, { attack: 0.001 }),
        );
        break;
      case "shell": // 또르륵 – three little descending ticks
        [0, 0.045, 0.085].forEach((d, i) =>
          this.burst(0.02, (0.13 - i * 0.03) * jv, { freq: (2400 - i * 500) / m, q: 3, delay: d }),
        );
        break;
      case "pearl":
        this.burst(0.03, 0.12 * jv, { type: "lowpass", freq: 2200 / m, q: 0.8 });
        this.tone("sine", (900 / m) * jp, (500 / m) * jp, 0.06, 0.16 * jv);
        break;
      default: // plastic 딱
        this.burst(0.028, 0.16 * jv, { type: "bandpass", freq: (2000 / m) * jp, q: 1.6 });
        this.tone("sine", (620 / m) * jp, (380 / m) * jp, 0.045, 0.14 * jv);
    }
  }

  /** bead slipped out of your fingers: dull "뚝" */
  slipped() {
    if (!this.ready) return;
    this.tone("sine", 190 * this.j(0.1), 110, 0.07, 0.3);
    this.burst(0.04, 0.08, { type: "lowpass", freq: 900, q: 0.7 });
  }

  /** timer end / soft cue */
  chime(up = true) {
    if (!this.ready) return;
    const f = up ? [880, 1320] : [660, 440];
    f.forEach((x, i) => this.tone("sine", x, x * 0.99, 0.35, 0.12, { delay: i * 0.09, attack: 0.005 }));
  }
}

export const sfx = new Sfx();

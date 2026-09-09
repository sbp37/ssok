import type { BeadMaterial, PopSound } from "../beads/BeadTypes";
import { SampleBank, type SampleName } from "./samples";

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
  private bank = new SampleBank();
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
    if (this.ctx && !this.warmed) {
      // a silent one-sample buffer opens the output path now, so the very first
      // real sound (the first POP) is not swallowed by the hardware warming up
      this.warmed = true;
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        src.connect(this.ctx.destination);
        src.start();
      } catch {
        /* ignore */
      }
    }
    if (this.ctx) this.bank.load(this.ctx);
  }
  private warmed = false;

  /** play a recorded sample if we have one; returns false to ask for the procedural fallback */
  private sample(name: SampleName, rate = 1, gain = 1, delay = 0) {
    const buf = this.bank.get(name);
    if (!buf || !this.ctx || !this.master) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * this.j(0.07);
    const g = ctx.createGain();
    g.gain.value = gain * this.j(0.1);
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime + delay);
    return true;
  }

  private get ready() {
    // a context still resuming queues what we schedule and plays it the moment it runs –
    // requiring "running" here silently ate the first sounds after every unlock
    return !!this.ctx && !!this.master && this.enabled && this.ctx.state !== "closed";
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
    if (this.sample("press", 1, 0.5)) return;
    this.burst(0.11 * this.j(0.15), 0.045 * this.j(0.2), { type: "lowpass", freq: 520, q: 0.6, attack: 0.018 });
    this.tone("sine", 85 * this.j(0.1), 55, 0.08, 0.03, { attack: 0.01 });
  }

  /** gel starting to give: sticky "찌익" – longer and lower for a heavy bead */
  stretch(mass: number) {
    if (!this.ready) return;
    if (this.sample("stretch", 1 / Math.pow(mass, 0.2), 0.5)) return;
    const heavy = Math.min(1, Math.max(0, mass - 0.9));
    this.burst((0.14 + heavy * 0.1) * this.j(0.15), (0.03 + heavy * 0.015) * this.j(0.2), {
      type: "bandpass",
      freq: 320 / Math.sqrt(mass),
      freq1: 900 / Math.sqrt(mass),
      q: 2.5,
      attack: 0.03,
    });
  }

  /**
   * the gel straining against a bead that won't come: a short rubbery creak whose
   * pitch and bite climb with `over` (0..1). Played as grains while wedged, and
   * once softly as the grip nears its limit.
   */
  creak(mass: number, over: number) {
    if (!this.ready) return;
    const m = Math.pow(mass, 0.3);
    if (this.sample("creak", (0.9 + over * 0.5) / m, 0.35 + over * 0.35)) return;
    const f = ((480 + over * 620) / m) * this.j(0.06);
    this.burst((0.06 + over * 0.05) * this.j(0.15), (0.03 + over * 0.04) * this.j(0.25), {
      type: "bandpass",
      freq: f,
      freq1: f * 1.4,
      q: 7,
      attack: 0.018,
    });
    // a low body under the squeak: the whole slab under tension
    this.tone("sine", (92 / Math.pow(mass, 0.25)) * this.j(0.05), 68, 0.09, 0.03 + over * 0.035, { attack: 0.02 });
  }

  /** a wedge gives way: dull rubbery "뚝" then a tick as the bead lurches */
  give(mass: number) {
    if (!this.ready) return;
    const m = Math.pow(mass, 0.3);
    if (this.sample("give", 1 / m, 0.7)) return;
    this.tone("sine", (210 / m) * this.j(0.08), 95, 0.09, 0.22);
    this.burst(0.03, 0.09, { type: "bandpass", freq: 1500 / m, q: 2 });
    this.burst(0.06, 0.05, { type: "lowpass", freq: 700, q: 0.7, delay: 0.01 });
  }

  /** stick-slip "딱… 딱…" as the bead creeps out */
  tick(mass: number, step: number) {
    if (!this.ready) return;
    if (this.sample("tick", (1 + step * 0.04) / Math.pow(mass, 0.2), 0.45)) return;
    const f = (2200 + step * 160) / Math.pow(mass, 0.35);
    // a tiny woody click: filtered noise with a very short body, no pure tone
    this.burst(0.014, 0.05 * this.j(0.2), { type: "bandpass", freq: f * this.j(0.08), q: 2.2 });
    this.burst(0.03, 0.02, { type: "lowpass", freq: 900, q: 0.7 });
    // heavy beads drag a faint rubber creak under each step
    if (mass > 1.05) this.burst(0.05, 0.018 * Math.min(1, mass - 1), { type: "bandpass", freq: 620 / Math.pow(mass, 0.3), freq1: 760 / Math.pow(mass, 0.3), q: 6, attack: 0.012 });
  }

  pop(kind: PopSound, mass: number, rare = false) {
    if (!this.ready) return;
    const m = Math.pow(mass, 0.45);
    const jp = this.j(0.08);
    const jv = this.j(0.1);
    const big = mass > 1.1;
    if (kind !== "ting" && this.sample(big ? "pop_big" : "pop_small", 1 / m, 0.9)) {
      if (rare) this.sample("rare", 1, 0.6, 0.04);
      return;
    }
    // every pop = a suction release (noise, lowpassed) + a short body that drops in pitch + a soft low thump
    switch (kind) {
      case "pok": // 뽁 – round
        this.burst(0.035, 0.22 * jv, { type: "lowpass", freq: 2600 / m, freq1: 600 / m, q: 0.8, attack: 0.002 });
        this.tone("sine", (640 / m) * jp, (240 / m) * jp, 0.07, 0.3 * jv, { attack: 0.003 });
        this.tone("triangle", (655 / m) * jp, (250 / m) * jp, 0.05, 0.06 * jv, { attack: 0.003, filter: 1500 });
        this.tone("sine", 140 * jp, 80, 0.06, 0.12 * jv, { attack: 0.004 });
        break;
      case "ssok": // 쏙 – airy suction then drop
        this.burst(0.05, 0.16 * jv, { type: "bandpass", freq: 1800, freq1: 500, q: 0.9, attack: 0.006 });
        this.tone("sine", (560 / m) * jp, (210 / m) * jp, 0.065, 0.26 * jv, { delay: 0.014, attack: 0.003 });
        this.tone("sine", 130 * jp, 75, 0.06, 0.1 * jv, { delay: 0.012 });
        break;
      case "pong": // 퐁 – big, hollow
        this.burst(0.06, 0.16 * jv, { type: "lowpass", freq: 1400 / m, freq1: 400 / m, q: 0.7, attack: 0.004 });
        this.tone("sine", (420 / m) * jp, (180 / m) * jp, 0.17, 0.42 * jv, { attack: 0.005 });
        this.tone("triangle", (430 / m) * jp, (185 / m) * jp, 0.12, 0.08 * jv, { attack: 0.005, filter: 1200 });
        this.tone("sine", 110 * jp, 65, 0.1, 0.16 * jv, { attack: 0.006 });
        break;
      case "tok": // 톡 – short, hard, woody
        this.burst(0.02, 0.24 * jv, { type: "bandpass", freq: (2600 / m) * jp, q: 1.6 });
        this.burst(0.05, 0.1 * jv, { type: "lowpass", freq: 900, q: 0.7 });
        this.tone("sine", (1000 / m) * jp, (520 / m) * jp, 0.04, 0.2 * jv);
        this.tone("sine", 150 * jp, 90, 0.05, 0.1 * jv);
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
    const sname: SampleName = material === "glass" ? "land_glass" : material === "metal" ? "land_metal" : material === "shell" ? "land_shell" : "land_plastic";
    if (this.sample(sname, 1 / m, 0.8)) return;
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

  /** let go of a stretched bead: soft "뭉" as the gel takes it back */
  release(mass: number) {
    if (!this.ready) return;
    if (this.sample("release", 1 / Math.pow(mass, 0.2), 0.5)) return;
    this.burst(0.07, 0.05, { type: "lowpass", freq: 600, q: 0.7, attack: 0.008 });
    this.tone("sine", 120 * this.j(0.1), 70, 0.07, 0.06, { attack: 0.006 });
  }

  /** bead slipped out of your fingers: dull "뚝" */
  slipped() {
    if (!this.ready) return;
    if (this.sample("release", 1, 0.8)) return;
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

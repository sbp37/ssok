import type { Bead } from "../beads/Bead";

export interface ChallengeResult {
  score: number;
  pulled: number;
  rare: number;
  special: number;
  bestCombo: number;
  duration: number;
  at: number;
}

export const COMBO_WINDOW = 1.25;

/** 30-second run bookkeeping. Pure state – no rendering, no storage. */
export class Challenge {
  readonly duration: number;
  remaining: number;
  running = false;
  score = 0;
  pulled = 0;
  rare = 0;
  special = 0;
  combo = 0;
  bestCombo = 0;
  private lastPop = -Infinity;
  elapsed = 0;

  constructor(duration = 30) {
    this.duration = duration;
    this.remaining = duration;
  }

  start() {
    this.running = true;
    this.remaining = this.duration;
    this.elapsed = 0;
    this.score = this.pulled = this.rare = this.special = this.combo = this.bestCombo = 0;
    this.lastPop = -Infinity;
  }

  /** returns true on the tick the timer runs out */
  tick(dt: number) {
    if (!this.running) return false;
    this.elapsed += dt;
    this.remaining = Math.max(0, this.duration - this.elapsed);
    if (this.elapsed - this.lastPop > COMBO_WINDOW) this.combo = 0;
    if (this.remaining <= 0) {
      this.running = false;
      return true;
    }
    return false;
  }

  onPop(bead: Bead) {
    if (!this.running) return { score: 0, combo: 0 };
    const gap = this.elapsed - this.lastPop;
    this.combo = gap <= COMBO_WINDOW ? this.combo + 1 : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastPop = this.elapsed;
    this.pulled++;
    if (bead.type.rarity === "rare") this.rare++;
    else if (bead.type.rarity === "special") this.special++;
    this.score += bead.type.score;
    return { score: bead.type.score, combo: this.combo };
  }

  result(): ChallengeResult {
    return {
      score: this.score,
      pulled: this.pulled,
      rare: this.rare,
      special: this.special,
      bestCombo: this.bestCombo,
      duration: this.duration,
      at: Date.now(),
    };
  }
}

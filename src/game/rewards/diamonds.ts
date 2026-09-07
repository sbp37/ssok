import { MISSIONS, type MissionId } from "./rates";

/**
 * Diamonds — a MOCK currency for testing whether people care to collect them.
 * They are never handed out by random beads: only by fixed, legible actions
 * (today's three missions). Nothing here pays out anything real.
 */
const KEY = "ssok.diamonds.v1";
interface Blob {
  diamonds: number;
  /** YYYY-MM-DD the missions belong to */
  day: string;
  progress: Record<string, number>;
  claimed: string[];
  adsWatched: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export interface MissionView {
  id: MissionId;
  label: string;
  goal: number;
  progress: number;
  done: boolean;
}

export class DiamondStore {
  private data: Blob = { diamonds: 0, day: today(), progress: {}, claimed: [], adsWatched: 0 };
  private listeners = new Set<() => void>();
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    this.rollover();
  }
  private rollover() {
    if (this.data.day !== today()) {
      this.data.day = today();
      this.data.progress = {};
      this.data.claimed = [];
      this.save();
    }
  }
  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  get diamonds() {
    return this.data.diamonds;
  }
  get adsWatched() {
    return this.data.adsWatched;
  }
  missions(): MissionView[] {
    this.rollover();
    return MISSIONS.map((m) => ({
      id: m.id,
      label: m.label,
      goal: m.goal,
      progress: Math.min(m.goal, this.data.progress[m.id] ?? 0),
      done: this.data.claimed.includes(m.id),
    }));
  }
  /**
   * advance a mission; returns the mission if this step completed it (one
   * diamond is granted right here, quietly)
   */
  advance(id: MissionId, by = 1): MissionView | null {
    this.rollover();
    const m = MISSIONS.find((x) => x.id === id)!;
    if (this.data.claimed.includes(id)) return null;
    this.data.progress[id] = (this.data.progress[id] ?? 0) + by;
    let completed: MissionView | null = null;
    if (this.data.progress[id] >= m.goal) {
      this.data.claimed.push(id);
      this.data.diamonds += 1;
      completed = { id: m.id, label: m.label, goal: m.goal, progress: m.goal, done: true };
    }
    this.save();
    return completed;
  }
  noteAdWatched() {
    this.data.adsWatched++;
    this.save();
  }
}

import type { BeadPreset } from './PadTypes';

/** Count the entire round, including buried beads, so a short first pad
 * cannot quietly turn into another full layer of work. Uses existing progress. */
export function roundBeadBudget(preset: BeadPreset, completed: number) {
  const first = completed < 1;
  const second = completed === 1;
  const visible = first ? 14 : second ? 18 : Math.round(preset.surface * 0.42);
  return {
    // Authored ribbon accents are part of the visible budget, not extras.
    surface: Math.max(1, visible - (preset.smallFillZones?.length ?? 0)),
    maxTotal: first ? 20 : second ? 24 : 28,
  };
}

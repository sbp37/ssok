/**
 * The release bundle (`pnpm toss:build:live`): live ad groups and promotion
 * codes, and none of the QA shortcuts (`?test=`, `?pad=`, `window.__ssok`).
 * A `?test=1` deep link must never turn pads into one-bead promotion farms.
 */
export const RELEASE = import.meta.env.VITE_PROMOTION_MODE === "live";

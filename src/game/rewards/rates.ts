/**
 * Every tunable reward number lives here. Rewards are things to *find*
 * (rare beads, buried objects) – there is no currency in this game.
 */

/**
 * Weighted hidden-object pool per pad: the same pad never reliably hides the
 * same thing. "none" is a real outcome (≈28%): an empty pad is what makes a
 * treasure feel like one. Ultra entries are the "뭐야 이거?" moments.
 */
export const NONE = "none";
export const HIDDEN_POOLS: Record<string, { id: string; w: number }[]> = {
  cloud: [
    { id: NONE, w: 38 },
    { id: "bigglass", w: 55 },
    { id: "candystar", w: 20 },
    { id: "smallshell", w: 12 },
    { id: "key", w: 8 },
    { id: "eye", w: 4 },
    { id: "bigduck", w: 1 },
  ],
  flower: [
    { id: NONE, w: 38 },
    { id: "candystar", w: 50 },
    { id: "bigopal", w: 22 },
    { id: "minicherry", w: 14 },
    { id: "eye", w: 8 },
    { id: "duck", w: 5 },
    { id: "holostar", w: 1 },
  ],
  donut: [
    { id: NONE, w: 38 },
    { id: "key", w: 48 },
    { id: "bigglass", w: 24 },
    { id: "candystar", w: 14 },
    { id: "eye", w: 9 },
    { id: "smallshell", w: 4 },
    { id: "crown", w: 1 },
  ],
  paw: [
    { id: NONE, w: 38 },
    { id: "eye", w: 50 },
    { id: "duck", w: 22 },
    { id: "minicherry", w: 14 },
    { id: "bigglass", w: 9 },
    { id: "key", w: 4 },
    { id: "bigduck", w: 1 },
  ],
  ribbon: [
    { id: NONE, w: 38 },
    { id: "bigopal", w: 50 },
    { id: "key", w: 22 },
    { id: "bigpearl", w: 15 },
    { id: "candystar", w: 8 },
    { id: "eye", w: 4 },
    { id: "crown", w: 1 },
  ],
  shell: [
    { id: NONE, w: 38 },
    { id: "bigpearl", w: 55 },
    { id: "bigopal", w: 23 },
    { id: "smallshell", w: 12 },
    { id: "key", w: 7 },
    { id: "duck", w: 2 },
    { id: "crown", w: 1 },
  ],
  cherry: [
    { id: NONE, w: 38 },
    { id: "minicherry", w: 55 },
    { id: "bigglass", w: 20 },
    { id: "eye", w: 12 },
    { id: "candystar", w: 8 },
    { id: "bigopal", w: 4 },
    { id: "holostar", w: 1 },
  ],
  heart: [
    { id: NONE, w: 38 },
    { id: "minicherry", w: 40 },
    { id: "bigopal", w: 24 },
    { id: "eye", w: 12 },
    { id: "key", w: 9 },
    { id: "duck", w: 5 },
    { id: "crown", w: 1 },
  ],
  cat: [
    { id: NONE, w: 38 },
    { id: "eye", w: 42 },
    { id: "smallshell", w: 22 },
    { id: "candystar", w: 14 },
    { id: "bigglass", w: 9 },
    { id: "key", w: 4 },
    { id: "holostar", w: 1 },
  ],
  bear: [
    { id: NONE, w: 38 },
    { id: "bigpearl", w: 40 },
    { id: "key", w: 22 },
    { id: "smallshell", w: 14 },
    { id: "candystar", w: 10 },
    { id: "eye", w: 4 },
    { id: "bigduck", w: 1 },
  ],
  star: [
    { id: NONE, w: 38 },
    { id: "duck", w: 45 },
    { id: "bigopal", w: 28 },
    { id: "candystar", w: 15 },
    { id: "key", w: 8 },
    { id: "bigglass", w: 3 },
    { id: "holostar", w: 1 },
  ],
};

/** chance that one deep bead of any pad is replaced by an ultra-rare object (on top of the pools' 1%) */
export const ULTRA_SURFACE_CHANCE = 0.004;

/** the first pads of a new player always hide something – the idea has to land before it gets rare */
export const FIRST_TREASURE_GUARANTEE = 3;

/** first pad of a new day: "none" is half as likely. That is the whole daily difference. */
export const DAY_NONE_FACTOR = 0.5;

/** pad variant rolls, applied when the next pad is chosen */
export const VARIANT_CHANCE = { rare: 0.07, super: 0.012 };

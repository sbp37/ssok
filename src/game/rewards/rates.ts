/**
 * Every tunable reward number lives here. Nothing in this file is a real
 * currency: diamonds are a mock until a points provider exists.
 */

/** weighted hidden-object pool per pad: the same pad never reliably hides the same thing */
export const HIDDEN_POOLS: Record<string, { id: string; w: number }[]> = {
  cloud: [
    { id: "bigglass", w: 55 },
    { id: "candystar", w: 20 },
    { id: "smallshell", w: 12 },
    { id: "key", w: 8 },
    { id: "eye", w: 4 },
    { id: "bigduck", w: 1 },
  ],
  flower: [
    { id: "candystar", w: 50 },
    { id: "bigopal", w: 22 },
    { id: "minicherry", w: 14 },
    { id: "eye", w: 8 },
    { id: "duck", w: 5 },
    { id: "holostar", w: 1 },
  ],
  donut: [
    { id: "key", w: 48 },
    { id: "bigglass", w: 24 },
    { id: "candystar", w: 14 },
    { id: "eye", w: 9 },
    { id: "smallshell", w: 4 },
    { id: "crown", w: 1 },
  ],
  paw: [
    { id: "eye", w: 50 },
    { id: "duck", w: 22 },
    { id: "minicherry", w: 14 },
    { id: "bigglass", w: 9 },
    { id: "key", w: 4 },
    { id: "bigduck", w: 1 },
  ],
  ribbon: [
    { id: "bigopal", w: 50 },
    { id: "key", w: 22 },
    { id: "bigpearl", w: 15 },
    { id: "candystar", w: 8 },
    { id: "eye", w: 4 },
    { id: "crown", w: 1 },
  ],
  shell: [
    { id: "bigpearl", w: 55 },
    { id: "bigopal", w: 23 },
    { id: "smallshell", w: 12 },
    { id: "key", w: 7 },
    { id: "duck", w: 2 },
    { id: "crown", w: 1 },
  ],
  cherry: [
    { id: "minicherry", w: 55 },
    { id: "bigglass", w: 20 },
    { id: "eye", w: 12 },
    { id: "candystar", w: 8 },
    { id: "bigopal", w: 4 },
    { id: "holostar", w: 1 },
  ],
  star: [
    { id: "duck", w: 45 },
    { id: "bigopal", w: 28 },
    { id: "candystar", w: 15 },
    { id: "key", w: 8 },
    { id: "bigglass", w: 3 },
    { id: "holostar", w: 1 },
  ],
};

/** chance that one deep bead of any pad is replaced by an ultra-rare object */
export const ULTRA_SURFACE_CHANCE = 0.006;

/** pad variant rolls, applied when the next pad is chosen */
export const VARIANT_CHANCE = { rare: 0.07, super: 0.012 };

/** daily missions, each worth one diamond */
export const MISSIONS = [
  { id: "pads3", label: "패드 3개 비우기", goal: 3 },
  { id: "hidden2", label: "숨은 보물 2개 찾기", goal: 2 },
  { id: "ads2", label: "광고로 다음 패드 2회 바로 열기", goal: 2 },
] as const;
export type MissionId = (typeof MISSIONS)[number]["id"];

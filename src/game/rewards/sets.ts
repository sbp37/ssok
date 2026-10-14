/**
 * Small collection sets: a few treasures that belong together. Short enough to
 * finish within a week of casual play – the box as a whole is too big a goal to
 * feel – plus one legendary set of the ultras for the long run.
 */
export interface TreasureSet {
  id: string;
  name: string;
  ids: readonly string[];
  /** a monthly theme's set: shown with that theme, findable only in its season */
  theme?: string;
}

export const TREASURE_SETS: readonly TreasureSet[] = [
  { id: "sea", name: "바다", ids: ["smallshell", "bigpearl", "bigglass"] },
  { id: "sweet", name: "달콤", ids: ["minicherry", "candystar", "rainbow"] },
  { id: "shine", name: "반짝", ids: ["bigopal", "opal", "key"] },
  { id: "friends", name: "친구", ids: ["duck", "eye"] },
  { id: "cozy", name: "포근", ids: ["cloudcharm", "pawcharm", "gummybear", "ribboncharm"] },
  { id: "legend", name: "전설", ids: ["crown", "holostar", "bigduck"] },
  { id: "autumn", name: "가을 숲", ids: ["maplestar", "pumpkinglass", "chestnutpearl"], theme: "autumn" },
  { id: "winter", name: "눈 오는 밤", ids: ["snowstar", "iceglass", "snowpearl"], theme: "winter" },
  { id: "spring", name: "봄 정원", ids: ["sakurastar", "springglass", "petalpearl"], theme: "spring" },
  { id: "summer", name: "여름 바다", ids: ["sunstar", "waveglass", "conchpearl"], theme: "summer" },
];

/** the set this find just completed, if any */
export function completedBy(id: string, has: (id: string) => boolean): TreasureSet | undefined {
  return TREASURE_SETS.find((s) => s.ids.includes(id) && s.ids.every((x) => x === id || has(x)));
}

import { registerPads, padById, type PadType } from "../pads/PadTypes";
import { THEME_PADS } from "../pads/ThemePads";

/**
 * Monthly themes: a season brings two limited pads and three treasures that
 * can only be found in them, plus a small set. Out of season the pads leave
 * the draw (what was found stays in the collection) and they come back when
 * the season does. Dates are the player's own calendar.
 */
export interface Theme {
  id: string;
  name: string;
  /** calendar months (1–12) the theme runs */
  months: readonly number[];
  /** "11월까지" style end label */
  until: string;
  /** "10~11월" style span label */
  span: string;
  pads: readonly string[];
  treasures: readonly string[];
}

export const THEMES: readonly Theme[] = [
  { id: "autumn", name: "가을 숲", months: [10, 11], until: "11월까지", span: "10~11월", pads: ["maple", "pumpkin"], treasures: ["maplestar", "pumpkinglass", "chestnutpearl"] },
  { id: "winter", name: "눈 오는 밤", months: [12, 1, 2], until: "2월까지", span: "12~2월", pads: ["snowman", "snowflake"], treasures: ["snowstar", "iceglass", "snowpearl"] },
  { id: "spring", name: "봄 정원", months: [3, 4, 5], until: "5월까지", span: "3~5월", pads: ["sakura", "tulip"], treasures: ["sakurastar", "springglass", "petalpearl"] },
  { id: "summer", name: "여름 바다", months: [6, 7, 8, 9], until: "9월까지", span: "6~9월", pads: ["watermelon", "icecream"], treasures: ["sunstar", "waveglass", "conchpearl"] },
];

registerPads(THEME_PADS);

/** the theme running on this date, if any */
export function activeTheme(date = new Date()): Theme | undefined {
  const m = date.getMonth() + 1;
  return THEMES.find((t) => t.months.includes(m));
}

/** the next theme to start after this date (for "다음 테마" when none or after the current one) */
export function upcomingTheme(date = new Date()): Theme | undefined {
  const now = activeTheme(date);
  for (let k = 1; k <= 12; k++) {
    const m = ((date.getMonth() + k) % 12) + 1;
    const t = THEMES.find((x) => x.months.includes(m));
    if (t && t !== now) return t;
  }
  return undefined;
}

/** the theme a pad belongs to */
export function themeOfPad(padId: string): Theme | undefined {
  const base = padId.split(":")[0];
  return THEMES.find((t) => t.pads.includes(base));
}

/** a theme's pads that actually exist in this build */
export function themePads(t: Theme): PadType[] {
  return t.pads.map((id) => padById(id)).filter((p): p is PadType => !!p);
}

/** completed pads before a theme pad can come up – the opening stays the everyday tour */
export const THEME_FROM = 3;
/** chance that the next pad is one of the season's pads (higher while one is still undiscovered) */
export const THEME_CHANCE = { undiscovered: 0.35, discovered: 0.2 };

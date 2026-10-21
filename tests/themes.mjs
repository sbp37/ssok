import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Monthly themes: calendar, the seasonal draw, and theme pads/treasures wiring.
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };

const themes = await load('rewards/themes');
const { activeTheme, upcomingTheme, themeOfPad, themePads, THEMES, THEME_FROM } = themes;
const d = (m, day = 15) => new Date(2026, m - 1, day);
assert.equal(activeTheme(d(10))?.id, 'autumn');
assert.equal(activeTheme(d(11, 30))?.id, 'autumn');
assert.equal(activeTheme(d(12, 1))?.id, 'winter');
assert.equal(activeTheme(d(2, 28))?.id, 'winter');
assert.equal(activeTheme(d(3, 1))?.id, 'spring');
assert.equal(activeTheme(d(5, 31))?.id, 'spring');
assert.equal(activeTheme(d(6, 1))?.id, 'summer');
assert.equal(activeTheme(d(9, 30))?.id, 'summer');
for (let m = 1; m <= 12; m++) assert.ok(activeTheme(d(m)), `a theme every month (${m})`);
assert.equal(upcomingTheme(d(10))?.id, 'winter');
assert.equal(upcomingTheme(d(5))?.id, 'summer');
assert.equal(upcomingTheme(d(8))?.id, 'autumn');

// every theme's pads exist, have hidden pools that bury their own treasures, and are not everyday pads
const { PADS, padById } = await load('pads/PadTypes');
const { HIDDEN_POOLS } = await load('rewards/rates');
const { TREASURE_TYPES, BOX_TYPES } = await load('rewards/treasure');
for (const t of THEMES) {
  assert.equal(themePads(t).length, t.pads.length, `${t.id}: all pads present`);
  for (const id of t.pads) {
    assert.ok(!PADS.some((p) => p.id === id), `${id} stays out of the everyday PADS`);
    assert.equal(themeOfPad(id)?.id, t.id);
    const pool = HIDDEN_POOLS[id];
    assert.ok(pool?.length, `${id} has a hidden pool`);
    for (const e of pool) assert.ok(e.id === 'none' || TREASURE_TYPES.some((x) => x.id === e.id), `${id}: ${e.id} is a treasure`);
    assert.ok(t.treasures.every((tr) => Object.values(HIDDEN_POOLS).some((p) => p.some((e) => e.id === tr))), `${t.id} treasures are buried somewhere`);
  }
  for (const tr of t.treasures) {
    assert.ok(!BOX_TYPES.some((x) => x.id === tr), `${tr} is not counted in the everyday box`);
    // only theme pads bury theme treasures
    for (const [pad, pool] of Object.entries(HIDDEN_POOLS)) if (pool.some((e) => e.id === tr)) assert.ok(t.pads.includes(pad), `${tr} only in ${t.id} pads (found in ${pad})`);
  }
}
assert.ok(padById('maple') && padById('snowman'), 'theme pads resolve by id');

// the seasonal draw: only in season, only after the opening pads, never twice in a row
const { PadProgress, DiscoveryProvider } = await load('pads/progress');
function run(month, completed, n = 600) {
  data.clear();
  const p = new PadProgress();
  for (let i = 0; i < completed; i++) { p.open(p.current); p.complete(); }
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const prov = new DiscoveryProvider(rand, () => d(month));
  let theme = 0, twice = 0, lastTheme = false;
  for (let i = 0; i < n; i++) {
    const pad = prov.next(p);
    const isTheme = !!themeOfPad(pad.id);
    if (isTheme) theme++;
    if (isTheme && lastTheme && pad.id === p.current.id) twice++;
    lastTheme = isTheme;
    p.open(pad); p.complete();
  }
  return { theme: theme / n, twice };
}
// a pad of another season never comes up
{ data.clear(); const p = new PadProgress(); for (let i = 0; i < 12; i++) { p.open(p.current); p.complete(); }
  let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const prov = new DiscoveryProvider(rand, () => d(10));
  for (let i = 0; i < 400; i++) { const pad = prov.next(p); const th = themeOfPad(pad.id); assert.ok(!th || th.id === 'autumn', `October drew ${pad.id}`); p.open(pad); p.complete(); } }
assert.equal(run(10, 0, THEME_FROM).theme, 0, 'opening pads: never');
const oct = run(10, 12);
assert.ok(oct.theme > 0.12 && oct.theme < 0.3, `in season ~20% (got ${oct.theme})`);
assert.equal(oct.twice, 0, 'the same theme pad never twice in a row');
assert.ok(run(12, 12).theme > 0.12, 'winter pads in December');
// countdown to a season's last day (0 on the day itself), across the new year for winter
{
  const { daysLeft, dDay, THEMES } = await load('rewards/themes');
  const th = (id) => THEMES.find((t) => t.id === id);
  assert.equal(daysLeft(th('autumn'), new Date(2026, 9, 21)), 40);
  assert.equal(daysLeft(th('autumn'), new Date(2026, 10, 30)), 0);
  assert.equal(daysLeft(th('winter'), new Date(2026, 11, 1)), 89, 'Dec 1 → Feb 28 next year');
  assert.equal(daysLeft(th('winter'), new Date(2028, 0, 31)), 29, 'leap February');
  assert.equal(daysLeft(th('summer'), new Date(2026, 5, 1)), 121);
  assert.equal(dDay(40), 'D-40');
  assert.equal(dDay(0), '오늘까지');
}
console.log('PASS: theme calendar, theme pads/pools/treasures wiring, seasonal draw (season only, after opening, ~20%, no repeats)');

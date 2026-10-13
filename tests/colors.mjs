import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Gel colours: varied, never repeating within the recent pads, identity colours kept.
const { GEL_PALETTE, OWN_COLORS, COLOR_MEMORY, pickGelColor, tinted, keepsOwnColor, colorKey } = await load('pads/colors');
const { PADS, resolvePad } = await load('pads/PadTypes');
const { THEME_PADS } = await load('pads/ThemePads');
await load('rewards/themes');

assert.ok(GEL_PALETTE.length >= 18, 'a wide palette');
for (const p of PADS) assert.ok(OWN_COLORS[p.id], `${p.id} has its own colour`);
const keys = GEL_PALETTE.map(colorKey);
assert.equal(new Set(keys).size, keys.length, 'no duplicate palette entries');

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const recent = [];
const seen = new Set();
const ownHits = { n: 0 };
for (let i = 0; i < 2000; i++) {
  const pad = PADS[i % PADS.length];
  const col = pickGelColor(pad, recent, rand);
  const last = recent.slice(-COLOR_MEMORY).map((k) => { const [r, g, b] = k.split(',').map(Number); return { r, g, b }; });
  assert.ok(last.every((x) => dist(x, col) >= 42), `pick ${i} repeats a recent colour`);
  if (colorKey(col) === colorKey(OWN_COLORS[pad.id])) ownHits.n++;
  recent.push(colorKey(col));
  seen.add(colorKey(col));
}
assert.ok(seen.size >= GEL_PALETTE.length - 1, `every colour comes up (${seen.size}/${GEL_PALETTE.length})`);
assert.ok(ownHits.n / 2000 > 0.1 && ownHits.n / 2000 < 0.5, `own colour sometimes, not always (${ownHits.n / 2000})`);

// identity colours: theme pads, and variants whose point is a colour
for (const p of THEME_PADS) { assert.ok(keepsOwnColor(p)); assert.equal(tinted(p, []), p); }
const lavender = resolvePad('butterfly:lavenderbutterfly');
assert.ok(keepsOwnColor(lavender), 'a colour variant keeps its colour');
const soft = resolvePad('cloud:softcloud');
assert.ok(!keepsOwnColor(soft), 'a softness variant can change colour');
const t = tinted(PADS[0], [], rand);
assert.equal(t.tinted, true);
assert.equal(tinted(t, []), t, 'tinting twice keeps the first pick');
assert.equal(t.id, PADS[0].id, 'same pad, new colour');
console.log(`PASS: ${GEL_PALETTE.length}-colour palette / no repeat within ${COLOR_MEMORY} pads over 2000 openings / all colours used / own colour ~${Math.round(ownHits.n / 20)}% / theme + colour variants keep theirs`);

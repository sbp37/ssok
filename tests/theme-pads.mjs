import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { THEME_PADS } = await load('pads/ThemePads');
const { PADS } = await load('pads/PadTypes');
const { generatePad } = await load('beads/Bead');
const { Rng } = await load('util/math');
assert.deepEqual(THEME_PADS.map(p => p.id), ['maple', 'pumpkin', 'snowman', 'snowflake']);
assert(THEME_PADS.every(p => !PADS.some(base => base.id === p.id)), 'limited pads stay outside the base catalog');
const rows = [];
for (const pad of THEME_PADS) {
  const samples = Array.from({ length: 1441 }, (_, i) => pad.outline(i / 1440 * Math.PI * 2));
  assert(samples.every(r => Number.isFinite(r) && r >= 0.6 && r <= 1.3), `${pad.id}: broad, finite radial silhouette`);
  for (let i = 1; i < samples.length; i++) {
    assert(Math.abs(samples[i] - samples[i - 1]) < 0.015, `${pad.id}: continuous adjacent samples`);
  }
  assert(Math.abs(samples[0] - samples.at(-1)) < 1e-9, `${pad.id}: continuous wrap seam`);
  assert(pad.beads.surface >= 40 && pad.beads.surface <= 48);
  assert.equal(pad.beads.edgeInset, 0.16, `${pad.id}: inset protects concave edges`);
  const counts = [];
  for (let seed = 1; seed <= 50; seed++) {
    const beads = generatePad(170, new Rng(seed), {
      ...pad.beads, boundary: pad.outline, deeper: false,
    });
    const surface = beads.filter(b => b.layer === 0);
    assert(surface.length >= Math.ceil(pad.beads.surface * 0.85), `${pad.id}, seed ${seed}: near-target packing`);
    assert(surface.length <= pad.beads.surface);
    for (const bead of surface) {
      assert(Number.isFinite(bead.rx + bead.ry + bead.radius));
      assert(Math.hypot(bead.rx, bead.ry) + bead.radius < 170 * pad.outline(Math.atan2(bead.ry, bead.rx)), `${pad.id}: bead stays inside`);
    }
    counts.push(surface.length);
  }
  const average = counts.reduce((a, b) => a + b, 0) / counts.length;
  assert(average >= pad.beads.surface * 0.9, `${pad.id}: average packing reaches 90% of preset`);
  rows.push({ pad: pad.id, minRadius: +Math.min(...samples).toFixed(3), target: pad.beads.surface, minPlaced: Math.min(...counts), average });
}
console.table(rows);
console.log('PASS: four limited silhouettes / continuity + wrap / broad radii / 200 near-target bead layouts');

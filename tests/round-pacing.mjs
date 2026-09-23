import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Load the actual pure generator and pad presets without a browser or new deps.
const modules = new Map();
function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
  });
  const code = outputText.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_, quote, name) =>
    `from ${quote}${moduleUrl(resolve(dirname(path), name + '.ts'))}${quote}`);
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  modules.set(path, url);
  return url;
}
const load = (name) => import(moduleUrl(fileURLToPath(new URL('../src/game/' + name + '.ts', import.meta.url))));
const { generatePad } = await load('beads/Bead');
const { PADS, VARIANTS, applyVariant } = await load('pads/PadTypes');
const { roundBeadBudget } = await load('pads/pacing');
const { Rng } = await load('util/math');
const rows = [];
for (const completed of [0, 1, 2, 50]) {
  let total = 0, oldTotal = 0, samples = 0, min = Infinity, max = 0;
  for (const pad of PADS) {
    const budget = roundBeadBudget(pad.beads, completed);
    for (let seed = 1; seed <= 50; seed++) {
      const options = {
        ...pad.beads, boundary: pad.outline, hole: pad.hole,
        hiddenObject: 'bigpearl', kingChance: pad.beads.kingChance ?? 0.3,
        deeperChance: 0.26 + (seed % 31) / 100, ultraChance: 0.006,
      };
      const old = generatePad(170, new Rng(seed), { ...options, surface: Math.round(pad.beads.surface * 0.7) });
      const beads = generatePad(170, new Rng(seed), { ...options, ...budget });
      assert(beads.length <= budget.maxTotal, `${pad.id}: ${beads.length} > ${budget.maxTotal}`);
      assert(beads.some(b => b.hidden && b.type.id === 'bigpearl'), 'planned treasure must survive the budget');
      assert(beads.every(b => Number.isFinite(b.rx + b.ry + b.radius + b.rot)));
      for (const bead of beads.filter(b => b.layer === 1)) {
        assert(beads.some(host => host.layer === 0 && host.slot === bead.slot), 'buried bead needs a host');
      }
      total += beads.length; oldTotal += old.length; samples++;
      min = Math.min(min, beads.length); max = Math.max(max, beads.length);
    }
    // Worst case: dense second layer + treasure + ultra + king all selected.
    for (let seed = 1; seed <= 20; seed++) {
      const beads = generatePad(170, new Rng(seed), {
        ...pad.beads, ...budget, boundary: pad.outline, hole: pad.hole,
        deeperChance: 2, hiddenObject: 'bigpearl', kingChance: 1, ultraChance: 1,
      });
      assert(beads.length <= budget.maxTotal, `${pad.id}: dense round exceeds budget`);
      assert(beads.some(b => b.hidden && b.type.id === 'king'), 'king must survive');
      assert(beads.some(b => b.hidden && b.type.id === 'bigpearl'), 'treasure must survive');
      assert(beads.filter(b => b.hidden).length >= 3, 'ultra replacement must survive');
    }
    for (const variant of VARIANTS[pad.id] ?? []) {
      const changed = applyVariant(pad, variant);
      assert.deepEqual(roundBeadBudget(changed.beads, completed), budget, 'variant must keep the same round length');
    }
  }
  assert(total < oldTotal * 0.75, 'normal rounds should be noticeably shorter');
  rows.push({ completed, min, max, average: +(total / samples).toFixed(1), previousAverage: +(oldTotal / samples).toFixed(1) });
}
assert.deepEqual(roundBeadBudget(PADS[0].beads, 50), roundBeadBudget(PADS[0].beads, 2), 'returning users keep regular pacing');
const test = generatePad(170, new Rng(12), {surface:5,deeper:false,spacing:40,forceTypes:['tiny','pearl','star','marble','long']});
assert.equal(test.length, 5, 'explicit tactile test mode stays exact');
console.table(rows);
console.log('PASS: 3,080 generated rounds / total budgets / treasure+king+ultra / variants / returning players / test mode');

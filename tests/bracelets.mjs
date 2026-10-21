import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Bracelets use only what is spare: pulled beads not yet strung, treasure copies not yet hung.
const { BraceletStore, MIN_BEADS, MAX_BEADS, MAX_BRACELETS, beadKey, splitKey, STRINGABLE } = await load('rewards/bracelets');
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const pink = beadKey('tiny', '#ff8fc4'), blue = beadKey('tiny', '#6fbfff'), pearl = beadKey('pearl', '#fbf3ee');
assert.deepEqual(splitKey(pink), { typeId: 'tiny', color: '#ff8fc4' });
assert.ok(STRINGABLE.every((t) => t.rarity !== 'rare'), 'rare beads are treasures, hung as charms');

// A new player starts with an empty box; beads pulled from pads drop in (treasures and junk do not).
let mem = memory();
let s = new BraceletStore(() => [], mem);
assert.equal(s.spareTotal, 0);
s.addBeads([['tiny', '#ff8fc4'], ['tiny', '#ff8fc4'], ['tiny', '#6fbfff'], ['duck', '#fff3c2'], ['rainbow', '#e4f2ff'], ['nope', '#ffffff'], ['tiny', 'red']]);
assert.equal(s.spare(pink), 2);
assert.equal(s.spareTotal, 3, 'only everyday beads count');

// A player from before bracelets starts with the beads in the jar album.
const seeded = new BraceletStore(() => [['pearl', '#fbf3ee'], ['pearl', '#fbf3ee'], ['duck', '#fff3c2']], memory());
assert.equal(seeded.spare(pearl), 2);

// Making a bracelet uses spare beads only, needs MIN..MAX beads and a free charm copy.
const owned = (id) => ({ duck: 1, key: 2 })[id] ?? 0;
s.addBeads(Array.from({ length: 20 }, () => ['tiny', '#ff8fc4']));
const eight = Array(MIN_BEADS).fill(pink);
assert.equal(s.make(Array(MIN_BEADS - 1).fill(pink), null, 'clear', owned), null, 'too short');
assert.equal(s.make(Array(MAX_BEADS + 1).fill(pink), null, 'clear', owned), null, 'too long');
assert.equal(s.make([...eight.slice(1), blue, blue], null, 'clear', owned), null, 'only one blue is spare');
assert.equal(s.make(eight, 'crown', 'clear', owned), null, 'a treasure not owned cannot hang');
assert.equal(s.make(eight, 'duck', 'rainbowcord', owned), null, 'unknown cord');
const a = s.make(eight, 'duck', 'pink', owned, 1000);
assert.ok(a && a.beads.length === MIN_BEADS && a.charm === 'duck' && a.cord === 'pink');
assert.equal(s.spare(pink), 22 - MIN_BEADS);
assert.equal(s.charmFree('duck', owned('duck')), 0, 'the only duck now hangs on a bracelet');
assert.equal(s.make(eight, 'duck', 'clear', owned), null, 'and cannot hang twice');
assert.ok(s.make(eight, 'key', 'gold', owned), 'a duplicate treasure can hang on another bracelet');
assert.equal(s.charmFree('key', owned('key')), 1);

// Kept across restarts; untying gives everything back.
s = new BraceletStore(() => [['tiny', '#ff8fc4']], mem);
assert.equal(s.bracelets.length, 2, 'a saved box is never re-seeded');
assert.equal(s.spare(pink), 22 - 2 * MIN_BEADS);
assert.equal(s.remove(a.id), true);
assert.equal(s.spare(pink), 22 - MIN_BEADS);
assert.equal(s.charmFree('duck', 1), 1);
assert.equal(s.remove('nope'), false);

// The box holds MAX_BRACELETS.
s.addBeads(Array.from({ length: MAX_BRACELETS * MIN_BEADS }, () => ['tiny', '#ff8fc4']));
while (!s.full) assert.ok(s.make(eight, null, 'clear', owned));
assert.equal(s.make(eight, null, 'clear', owned), null);

// Junk is repaired: bad keys, short bracelets, unknown charms and cords.
const junk = memory();
junk.setItem('ssok.bracelets.v1', JSON.stringify({
  stock: { [pink]: 10, 'tiny|red': 4, 'rainbow|#e4f2ff': 3, [blue]: -2 },
  list: [{ id: 'x', at: 1, beads: Array(MIN_BEADS).fill(pink), charm: 'zzz', cord: 'neon' }, { id: 'y', beads: [pink] }, null],
}));
const j = new BraceletStore(() => [], junk);
assert.equal(j.bracelets.length, 1);
assert.deepEqual([j.bracelets[0].charm, j.bracelets[0].cord], [null, 'clear']);
assert.equal(j.spare(pink), 10 - MIN_BEADS);
assert.equal(j.spare(blue), 0);
const broken = { getItem: () => { throw Error('private'); }, setItem: () => { throw Error('private'); } };
assert.doesNotThrow(() => new BraceletStore(() => [], broken).addBeads([['tiny', '#ff8fc4']]));
console.log('PASS: pulled beads into the box (seeded from the album) / spare beads only / 8–16 beads / one charm per treasure copy / persistence / untie gives back / box of 12 / junk repaired');

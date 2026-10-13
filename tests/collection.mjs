import assert from 'node:assert/strict';
import { load, loadFresh } from './load.mjs';
// Shelf, pinned target, sets and the catch-up for missing treasures.
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };

const { missingBoost, NONE, DRY_MAX, TARGET_BOOST } = await load('rewards/rates');
const ultraIds = ['crown', 'holostar', 'bigduck'];
const b = (id, o) => missingBoost(id, { found: false, dry: 0, target: null, ultraIds, ...o });
assert.equal(b('key'), 1, 'no catch-up on a fresh streak');
assert.equal(b('key', { dry: 4 }), 2);
assert.equal(b('key', { dry: 40 }), DRY_MAX, 'capped');
assert.equal(b('key', { dry: 4, found: true }), 1, 'found treasures are not boosted');
assert.equal(b(NONE, { dry: 40 }), 1, '"none" untouched');
assert.equal(b('crown', { dry: 40, target: 'crown' }), 1, 'ultras stay legendary');
assert.equal(b('key', { target: 'key' }), TARGET_BOOST, 'pinned target doubles');

const { TREASURE_SETS, completedBy } = await load('rewards/sets');
const { TREASURE_TYPES, TreasureStore, SHELF_SIZE } = await loadFresh('rewards/treasure');
const known = new Set(TREASURE_TYPES.map((t) => t.id));
for (const s of TREASURE_SETS) for (const id of s.ids) assert.ok(known.has(id), `${s.id}: ${id} is a treasure`);
assert.equal(completedBy('eye', (x) => x === 'duck')?.id, 'friends');
assert.equal(completedBy('eye', () => false), undefined);

const t = new TreasureStore();
t.setTarget('key');
assert.equal(t.target, 'key');
let r = t.add('smallshell', '구름');
assert.deepEqual([r.isNew, r.shelved, r.targetHit], [true, true, false], 'first find goes on the shelf');
assert.deepEqual([...t.shelf], ['smallshell']);
assert.equal(t.firstFound('smallshell').pad, '구름');
t.noteDryPad(); t.noteDryPad();
assert.equal(t.dry, 2);
r = t.add('bigpearl', '조개');
assert.equal(t.dry, 0, 'a first find resets the streak');
assert.equal(r.shelved, false, 'only the very first find is auto-shelved');
r = t.add('bigglass', '도넛');
assert.equal(r.setDone?.id, 'sea', 'third sea treasure completes the set');
r = t.add('bigglass', '도넛');
assert.equal(r.setDone, undefined, 'a repeat does not complete it again');
r = t.add('key', '리본');
assert.equal(r.targetHit, true);
assert.equal(t.target, null, 'found target is unpinned');
t.setTarget('key');
assert.equal(t.target, null, 'cannot pin something already found');
assert.equal(t.toggleShelf('eye'), false, 'not found → not shelvable');
for (const id of ['bigpearl', 'bigglass', 'key']) assert.equal(t.toggleShelf(id), true);
t.add('duck');
assert.equal(t.toggleShelf('duck'), true);
assert.equal(t.shelf.length, SHELF_SIZE);
t.add('eye');
assert.equal(t.toggleShelf('eye'), false, 'full shelf');
assert.equal(t.toggleShelf('key'), true, 'take one off');
assert.equal(t.onShelf('key'), false);

// persisted, and repaired: shelf entries that are not found, or unknown, are dropped
const saved = JSON.parse(data.get('ssok.treasure.v1'));
data.set('ssok.treasure.v1', JSON.stringify({ ...saved, shelf: [...saved.shelf, 'crown', 'nope', 'duck'], target: 'bigopal', dry: -3 }));
const u = new (await loadFresh('rewards/treasure')).TreasureStore();
assert.deepEqual([...u.shelf], saved.shelf);
assert.equal(u.target, 'bigopal');
assert.equal(u.dry, 0);
console.log('PASS: catch-up boost (cap, found, none, ultra, pin), sets, first find shelved, pin hit/unpin, shelf limit, persistence + repair');

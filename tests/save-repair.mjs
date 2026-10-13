import assert from 'node:assert/strict';
import { loadFresh } from './load.mjs';
// A well-formed JSON save with wrong field types must repair itself, never stop the game.
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };

data.set('ssok.progress.v2', JSON.stringify({
  v: 2, mode: 'nonsense', current: 42, currentDone: 'yes', discoveredPads: null, discoveredVariants: { a: 1 },
  playCount: { cloud: 3, nope: 9, flower: -1 }, totalCompleted: '7', recent: ['cloud', 5, 'zzz'], nextId: 'nope', dayBonusPending: 1,
}));
const { PadProgress } = await loadFresh('pads/progress');
const p = new PadProgress();
assert.equal(p.current.id, 'cloud');
assert.equal(p.currentDone, false);
assert.deepEqual([...p.discoveredPads], []);
assert.equal(p.isDiscovered('cloud'), false);
assert.equal(p.playCount('cloud'), 3);
assert.equal(p.playCount('flower'), 0);
assert.equal(p.totalCompleted, 0);
assert.deepEqual([...p.recent], ['cloud']);
assert.equal(p.nextId, null);
p.open(p.current);
p.complete();
assert.equal(p.totalCompleted, 1);

// good saves keep everything
data.set('ssok.progress.v2', JSON.stringify({ ...JSON.parse(data.get('ssok.progress.v2')), discoveredPads: ['cloud', 'flower'], nextId: 'flower', nextHidden: null }));
const q = new (await loadFresh('pads/progress')).PadProgress();
assert.deepEqual([...q.discoveredPads], ['cloud', 'flower']);
assert.equal(q.nextId, 'flower');
assert.equal(q.nextHidden, null);
assert.equal(q.totalCompleted, 1);

// the treasure box: malformed maps drop only their bad entries
data.set('ssok.treasure.v1', JSON.stringify({ counts: { key: 2, eye: 'x' }, firstAt: null, seen: [1, 2] }));
const { TreasureStore } = await loadFresh('rewards/treasure');
const t = new TreasureStore();
t.add('duck');
assert.equal(t.has('duck'), true);
assert.equal(t.has('eye'), false);
console.log('PASS: malformed progress / treasure saves repair field by field; good saves are kept');

import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { BoundedCache } = await load('util/BoundedCache');
const cache = new BoundedCache(3);
cache.set('a', 1).set('b', 2).set('c', 3);
assert.equal(cache.get('a'), 1);
cache.set('d', 4);
assert.equal(cache.has('b'), false, 'evict least recently used, not current bead');
cache.set('a', 9);
assert.equal(cache.size, 3);
assert.equal(cache.get('a'), 9);
for (let i = 0; i < 10000; i++) cache.set(i, i);
assert.equal(cache.size, 3, 'long sessions stay bounded');
assert.deepEqual([...cache.keys()], [9997, 9998, 9999]);
cache.clear();
assert.equal(cache.size, 0);
console.log('PASS: bounded raster cache / access refresh / replacement / 10,000 inserts / clear');

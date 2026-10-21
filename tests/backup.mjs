import assert from 'node:assert/strict';
import { load } from './load.mjs';

// a web view's localStorage
const web = new Map();
globalThis.localStorage = {
  get length() { return web.size; },
  key: (i) => [...web.keys()][i] ?? null,
  getItem: (k) => (web.has(k) ? web.get(k) : null),
  setItem: (k, v) => web.set(k, String(v)),
  removeItem: (k) => web.delete(k),
};
const { restoreBackup, backupNow } = await load('backup');
const nativeStore = new Map();
const nativeHost = { getItem: async (k) => nativeStore.get(k) ?? null, setItem: async (k, v) => void nativeStore.set(k, v) };

// Outside the Toss app: nothing happens, nothing throws.
web.set('ssok.progress.v2', '{"v":2}');
assert.equal(await restoreBackup(), false);
await backupNow();
web.clear();
assert.equal(await restoreBackup(), false);

// Inside: the whole "ssok." save is copied, nothing else.
globalThis.__native = nativeHost;
web.set('ssok.progress.v2', '{"v":2,"totalCompleted":7}');
web.set('ssok.promotions.v1', '{"granted":["A"]}');
web.set('ssok.jars.v1', '[1,2]');
web.set('other.app', 'x');
await backupNow();
const copy = JSON.parse(nativeStore.get('ssok.backup.v1'));
assert.deepEqual(Object.keys(copy).sort(), ['ssok.jars.v1', 'ssok.progress.v2', 'ssok.promotions.v1']);

// A save that exists is never overwritten by the copy.
web.set('ssok.progress.v2', '{"v":2,"totalCompleted":9}');
assert.equal(await restoreBackup(), false);
assert.equal(web.get('ssok.progress.v2'), '{"v":2,"totalCompleted":9}');

// A wiped web view gets everything back – including which promotions were already paid.
web.clear();
assert.equal(await restoreBackup(), true);
assert.equal(web.get('ssok.progress.v2'), '{"v":2,"totalCompleted":7}');
assert.equal(web.get('ssok.promotions.v1'), '{"granted":["A"]}');
assert.equal(web.has('other.app'), false);

// A copy without a save in it, junk, or foreign keys: nothing is written.
web.clear();
nativeStore.set('ssok.backup.v1', JSON.stringify({ 'ssok.jars.v1': '[]' }));
assert.equal(await restoreBackup(), false);
nativeStore.set('ssok.backup.v1', '{not json');
assert.equal(await restoreBackup(), false);
nativeStore.set('ssok.backup.v1', JSON.stringify({ 'ssok.progress.v2': '{}', 'evil.key': 'x', 'ssok.n': 5 }));
assert.equal(await restoreBackup(), true);
assert.deepEqual([...web.keys()], ['ssok.progress.v2']);
// No save at all yet: nothing is copied over an older backup.
web.clear();
nativeStore.set('ssok.backup.v1', 'older');
await backupNow();
assert.equal(nativeStore.get('ssok.backup.v1'), 'older');

// A bridge that never answers cannot hold the start.
globalThis.__native = { getItem: () => new Promise(() => {}), setItem: async () => {} };
const t0 = Date.now();
assert.equal(await restoreBackup(30), false);
assert.ok(Date.now() - t0 < 500);
delete globalThis.__native;
console.log('PASS: native save copy / never over a live save / wiped web view restored incl. paid promotions / junk ignored / no host / slow bridge');

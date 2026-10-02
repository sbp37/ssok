import assert from 'node:assert/strict';
import { load } from './load.mjs';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const calls = [];
globalThis.__sdk = { grantReward: async (o) => (calls.push(o), { key: 'ok-' + calls.length }) };

// Default (QA) build: TEST_ codes only, whatever else happens.
const test = await load('rewards/PromotionRewards');
const qa = new test.PromotionRewards(memory());
assert.equal(qa.mode, 'test');
qa.onPadCompleted(1);
await new Promise((r) => setTimeout(r, 0));
assert.equal(calls.length, 1);
assert.ok(calls[0].promotionCode.startsWith('TEST_'), 'a QA build must never send a live code');
assert.equal(calls[0].amount, 1);

// New progress rewards use their exact TEST_ codes and only become eligible at 5/10 completed pads.
calls.length = 0;
globalThis.__sdk.grantReward = async (o) => (calls.push(o), { key: 'milestone-' + calls.length });
const progressRewards = new test.PromotionRewards(memory());
assert.equal(await progressRewards.grant('firstPad'), true);
assert.equal(await progressRewards.grant('thirdPad'), true);
calls.length = 0;
progressRewards.onPadCompleted(4);
await new Promise((r) => setTimeout(r, 0));
assert.equal(calls.length, 0, '5-pad reward does not fire early');
progressRewards.onPadCompleted(5);
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(calls, [{ promotionCode: 'TEST_01M3PRX7ZP8GAM2HZ9Z7NQ31KT', amount: 5 }]);
calls.length = 0;
progressRewards.onPadCompleted(9);
await new Promise((r) => setTimeout(r, 0));
assert.equal(calls.length, 0, '10-pad reward does not fire early');
progressRewards.onPadCompleted(10);
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(calls, [{ promotionCode: 'TEST_01M3PS0C2YGKRKPC98FW37NSTZ', amount: 10 }]);

// Same install: a granted milestone is never requested twice, even across restarts.
const storage = memory();
calls.length = 0;
const a = new test.PromotionRewards(storage);
assert.equal(await a.grant('thirdPad'), true);
assert.equal(await a.grant('thirdPad'), false);
assert.equal(await new test.PromotionRewards(storage).grant('thirdPad'), false);
assert.equal(calls.length, 1);

// Double tap while the first request is in flight → one request.
calls.length = 0;
let release;
globalThis.__sdk.grantReward = (o) => (calls.push(o), new Promise((r) => (release = () => r({ key: 'k' }))));
const b = new test.PromotionRewards(memory());
const first = b.grant('returnVisit');
assert.equal(await b.grant('returnVisit'), false);
release();
assert.equal(await first, true);
assert.equal(calls.length, 1);

// Failures and a missing bridge never throw into the game.
globalThis.__sdk.grantReward = async () => { throw new Error('network'); };
const warn = console.warn;
console.warn = () => {};
assert.equal(await new test.PromotionRewards(memory()).grant('firstPad'), false);
console.warn = warn;
globalThis.__sdk = undefined;
assert.equal(await new test.PromotionRewards(memory()).grant('firstPad'), false);
const broken = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
assert.doesNotThrow(() => new test.PromotionRewards(broken));

// Live build: only when explicitly asked for, and the QA auto-run is disabled there.
calls.length = 0;
globalThis.__sdk = { grantReward: async (o) => (calls.push(o), { key: 'live' }) };
const live = await load('rewards/PromotionRewards', { VITE_PROMOTION_MODE: 'live' });
const l = new live.PromotionRewards(memory());
assert.equal(l.mode, 'live');
assert.deepEqual(await l.runTestMilestones(), []);
assert.equal(calls.length, 0, 'live builds never auto-run the QA milestones');
assert.equal(await l.grant('firstPad'), true);
assert.ok(!calls[0].promotionCode.startsWith('TEST_'));
assert.equal(await l.grant('fifthPad'), true);
assert.deepEqual(calls[1], { promotionCode: '01M3PRX7ZP8GAM2HZ9Z7NQ31KT', amount: 5 });
assert.equal(await l.grant('tenthPad'), true);
assert.deepEqual(calls[2], { promotionCode: '01M3PS0C2YGKRKPC98FW37NSTZ', amount: 10 });

// Anything other than exactly "live" stays in test mode.
for (const value of ['LIVE', 'true', '1', 'production', '']) {
  const m = await load('rewards/PromotionRewards', { VITE_PROMOTION_MODE: value });
  assert.equal(new m.PromotionRewards(memory()).mode, 'test', `VITE_PROMOTION_MODE=${JSON.stringify(value)}`);
}
console.log('PASS: 1/3/5/10/return thresholds / exact TEST codes / dedup / in-flight lock / failures / live only when explicit');

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
// A milestone that failed is remembered and asked again on the next start – the 10th pad
// may be the last one ever played, and a failed return visit is retried the same day.
const tick = () => new Promise((r) => setTimeout(r, 0));
const failWith = (code) => async () => { const e = new Error('x'); e.code = code; throw e; };
console.warn = () => {};
const saved = memory();
calls.length = 0;
globalThis.__sdk = { grantReward: failWith('4112') }; // out of promotion money: surely not paid
const p1 = new test.PromotionRewards(saved);
p1.onPadCompleted(10);
p1.onVisit(true, 10);
await tick();
globalThis.__sdk = { grantReward: async (o) => (calls.push(o), { key: 'later' }) };
const p2 = new test.PromotionRewards(saved);
p2.onVisit(false, 10); // same day, a later start: not a new day, still owed
await tick();
assert.deepEqual(calls.map((c) => c.amount).sort((a, b) => a - b), [1, 2, 3, 5, 10], 'every owed milestone is paid on the next start');
calls.length = 0;
const p3 = new test.PromotionRewards(saved);
p3.onVisit(true, 11);
p3.onPadCompleted(11);
await tick();
assert.equal(calls.length, 0, 'paid milestones are never asked again');

// After a failure the same session does not ask again at every pad – the next start does.
let asked = 0;
globalThis.__sdk = { grantReward: async () => { asked++; throw Object.assign(new Error('empty'), { code: '4112' }); } };
const busy = new test.PromotionRewards(memory());
for (let n = 1; n <= 12; n++) { busy.onPadCompleted(n); await tick(); }
assert.equal(asked, 4, 'one try per milestone per session (1, 3, 5, 10)');

// "Not paid" answers can be retried freely; unknown failures (which may have paid) only MAX_UNSURE times.
const capped = memory();
let attempts = 0;
globalThis.__sdk = { grantReward: async () => { attempts++; throw Object.assign(new Error('?'), { code: 'UNKNOWN_ERROR' }); } };
for (let i = 0; i < test.MAX_UNSURE + 3; i++) {
  assert.equal(await new test.PromotionRewards(capped).grant('firstPad'), false);
}
assert.equal(attempts, test.MAX_UNSURE, 'an ambiguous failure is not retried forever');
attempts = 0;
const definite = memory();
globalThis.__sdk = { grantReward: async () => { attempts++; throw Object.assign(new Error('paused'), { code: '4109' }); } };
for (let i = 0; i < test.MAX_UNSURE + 3; i++) await new test.PromotionRewards(definite).grant('firstPad');
assert.equal(attempts, test.MAX_UNSURE + 3, 'a paused promotion is asked again once it may run');
// a reply without a key counts as unsure too
attempts = 0;
globalThis.__sdk = { grantReward: async () => (attempts++, {}) };
const odd = memory();
for (let i = 0; i < test.MAX_UNSURE + 1; i++) await new test.PromotionRewards(odd).grant('thirdPad');
assert.equal(attempts, test.MAX_UNSURE);
// A request the app never heard back from (closed mid-request) counts as unsure too.
attempts = 0;
globalThis.__sdk = { grantReward: () => { attempts++; return new Promise(() => {}); } };
const hung = memory();
for (let i = 0; i < test.MAX_UNSURE + 3; i++) { new test.PromotionRewards(hung).onPadCompleted(1); await tick(); }
assert.equal(attempts, test.MAX_UNSURE, 'restarts during unanswered requests cannot pay out again and again');
console.warn = warn;
// malformed saved state is repaired, not trusted
const junk = memory();
junk.setItem('ssok.promotions.v1', JSON.stringify({ granted: ['TEST_01M2G7DZXEHF60PHHQ6ZA5342T', 5], pending: ['bogus', 'thirdPad'], unsure: { a: 'x', b: -1 } }));
calls.length = 0;
globalThis.__sdk = { grantReward: async (o) => (calls.push(o), { key: 'k' }) };
new test.PromotionRewards(junk).retryPending();
await tick();
assert.deepEqual(calls, [{ promotionCode: 'TEST_01M2G7F5WHW5HD8KWP1JRSFYYS', amount: 3 }]);
console.log('PASS: 1/3/5/10/return thresholds / exact TEST codes / dedup / in-flight lock / failures / live only when explicit / owed milestones retried next start / ambiguous failures capped / saved state repaired');

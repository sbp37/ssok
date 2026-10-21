import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Policy timing only: the loader stubs the host SDK, so no real ad bridge can be touched.
const { AdPolicy, MockAdProvider, TossAdProvider, createAdProvider, FREE_PADS, MIN_GAP_MS, AD_GROUP_IDS, LIVE_ADS, LOAD_TIMEOUT_MS, RETRY_MS, OPEN_GRACE_MS } = await load('ads/AdPolicy');
let clock = 1_000_000, calls = 0;
const data = new Map();
const storage = {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};
const provider = {ready:()=>true,show:async kind=>{calls++;return kind==='rewarded'?'rewarded':'closed';}};
const p = new AdPolicy(provider,()=>clock,storage,20);

// The opening pads are free.
assert.equal(FREE_PADS, 2);
assert.equal(await p.next('interstitial',1),'unavailable', 'first NEXT is ad-free');
assert.equal(calls, 0);
// From then on every transition is a candidate, at least MIN_GAP_MS apart.
assert.equal(await p.next('interstitial',2),'closed');
clock += MIN_GAP_MS - 1;
assert.equal(await p.next('interstitial',3),'unavailable', 'too soon after the last full-screen ad');
clock += 1;
assert.equal(await p.next('interstitial',3),'closed');
// A rewarded ad counts as the last full-screen ad too: no interstitial right after it.
clock += MIN_GAP_MS;
assert.equal(await p.next('rewarded',4),'rewarded');
assert.equal(p.eligible(5), false, 'rewarded just played');
clock += MIN_GAP_MS;
assert.equal(await p.next('interstitial',5),'closed');

// Persistence: completion and time both survive a restart.
const restored = new AdPolicy(provider,()=>clock,storage,20);
assert.equal(restored.eligible(5),false);
assert.equal(restored.eligible(6),false, 'gap restored');
clock += MIN_GAP_MS;
assert.equal(restored.eligible(6),true);
restored.provider = {ready:()=>false,show:()=>assert.fail('no fill must not show')};
assert.equal(restored.ready('rewarded'), false);
assert.equal(await restored.next('interstitial',6),'unavailable');
assert.equal(restored.eligible(6),true,'no-fill does not consume the next transition');
restored.provider = {ready:()=>true,show:async()=>{throw Error('network');}};
assert.equal(await restored.next('interstitial',6),'unavailable');
assert.equal(restored.eligible(6),true,'show failure does not consume the transition');
restored.provider = {ready:()=>{throw Error('bridge');}};
assert.equal(restored.ready('rewarded'), false, 'a throwing bridge reads as not ready');

// Watchdog: an ad that never opens is aborted…
let aborted = false;
restored.provider = {ready:()=>true,show:(_,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}};
const pending = restored.next('interstitial',6);
assert.equal(await restored.next('interstitial',6),null, 'double tap');
assert.equal(await pending,'unavailable');
assert.equal(aborted,true);
// …but once it is on screen only its dismissal ends it (a long rewarded ad keeps its reward).
restored.provider = {ready:()=>true,show:(_,signal,onOpen)=>new Promise((resolve)=>{
  onOpen();
  signal.addEventListener('abort',()=>assert.fail('an open ad must not be aborted'));
  setTimeout(()=>resolve('rewarded'), 60);
})};
assert.equal(await restored.next('rewarded',6),'rewarded', 'opened ad outlives the 20ms watchdog');
clock += MIN_GAP_MS;
restored.provider = provider;
assert.equal(await restored.next('interstitial',7),'closed'); // lock released after failure

// A failed rewarded door waives the interstitial of that same transition.
clock += MIN_GAP_MS;
assert.equal(restored.eligible(8), true);
restored.waive(8);
assert.equal(restored.eligible(8), false, 'failed door → plain NEXT without an interstitial');
assert.equal(restored.eligible(9), true, 'the next transition is a candidate again');

// Ad groups: dev/QA bundles never touch a live group.
assert.equal(LIVE_ADS, false);
for (const id of Object.values(AD_GROUP_IDS)) assert.ok(id.startsWith('ait-ad-test-'), id);
const live = await load('ads/AdPolicy', { VITE_PROMOTION_MODE: 'live' });
assert.equal(live.LIVE_ADS, true);
for (const id of Object.values(live.AD_GROUP_IDS)) assert.ok(id.startsWith('ait.v2.live.'), id);

assert.equal(new MockAdProvider().ready('interstitial'),false);
assert.ok(createAdProvider() instanceof MockAdProvider, 'no Toss host → mock provider');
// a release bundle on an old Toss app without full-screen ads: no doors and no free rewards
const noAds = live.createAdProvider();
assert.ok(noAds instanceof live.NoAdProvider);
assert.equal(noAds.ready('rewarded'), false);
assert.equal(await new live.AdPolicy(noAds,()=>clock,storage).next('rewarded',3),'unavailable');
let mockEarned = 0;
assert.equal(await new MockAdProvider().show('rewarded', new AbortController().signal, undefined, () => mockEarned++), 'rewarded');
assert.equal(mockEarned, 1, 'the mock reports its reward like the SDK does');
const broken = {getItem:()=>{throw Error('private');},setItem:()=>{throw Error('private');}};
const privatePolicy = new AdPolicy(provider,()=>clock,broken);
assert.equal(await privatePolicy.next('rewarded',2),'rewarded');
// ── TossAdProvider against a fake bridge and a fake clock ──
const realTimers = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
const realPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
let now = 0, timerSerial = 0;
const due = new Map();
globalThis.setTimeout = (fn, ms = 0) => { due.set(++timerSerial, { at: now + ms, fn }); return timerSerial; };
globalThis.clearTimeout = (id) => { due.delete(id); };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
const advance = (ms) => {
  const end = now + ms;
  for (;;) {
    const next = [...due].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    due.delete(next[0]);
    now = next[1].at;
    next[1].fn();
  }
  now = end;
};
globalThis.window = new EventTarget();
globalThis.document = { getElementById: () => null };
const flush = () => new Promise((r) => realTimers.set(r, 0));

const bridge = { loads: [], shows: [], unregistered: 0 };
globalThis.__ads = {
  load: (o) => { bridge.loads.push(o); return () => bridge.unregistered++; },
  show: (o) => { bridge.shows.push(o); return () => bridge.unregistered++; },
};
const lastLoad = (id) => bridge.loads.filter((o) => o.options.adGroupId === AD_GROUP_IDS[id]).at(-1);
const loadsOf = (id) => bridge.loads.filter((o) => o.options.adGroupId === AD_GROUP_IDS[id]).length;

const toss = new TossAdProvider();
assert.equal(loadsOf('interstitial'), 1);
assert.equal(loadsOf('rewarded'), 1);
lastLoad('interstitial').onEvent({ type: 'loaded' });
assert.equal(toss.ready('interstitial'), true);

// A failed load backs off – polling ready() every second must not re-request it.
lastLoad('rewarded').onError(new Error('no fill'));
for (let s = 0; s < 14; s++) { advance(1000); assert.equal(toss.ready('rewarded'), false); }
assert.equal(loadsOf('rewarded'), 1, 'no reload inside the back-off');
advance(RETRY_MS[0] - 14_000);
assert.equal(loadsOf('rewarded'), 2, 'reloads when the back-off ends');
lastLoad('rewarded').onError(new Error('no fill'));
advance(RETRY_MS[0]);
assert.equal(loadsOf('rewarded'), 2, 'the second wait is longer');
advance(RETRY_MS[1] - RETRY_MS[0]);
assert.equal(loadsOf('rewarded'), 3);

// A load that never answers is given up, retried later, and a late answer is ignored.
const silent = lastLoad('rewarded');
advance(LOAD_TIMEOUT_MS);
assert.equal(toss.ready('rewarded'), false);
silent.onEvent({ type: 'loaded' });
assert.equal(toss.ready('rewarded'), false, 'a late fill from an abandoned request does not count');
advance(RETRY_MS[2]);
assert.equal(loadsOf('rewarded'), 4);
lastLoad('rewarded').onEvent({ type: 'loaded' });
assert.equal(toss.ready('rewarded'), true);

const signal = () => new AbortController().signal;
const lastShow = () => bridge.shows.at(-1);
// Earned, then dismissed: rewarded, and the reward hook runs once at the earned event.
let earned = 0, opened = 0;
let shown = toss.show('rewarded', signal(), () => opened++, () => earned++);
lastShow().onEvent({ type: 'show' });
lastShow().onEvent({ type: 'userEarnedReward', data: { unitType: 'x', unitAmount: 1 } });
lastShow().onEvent({ type: 'userEarnedReward', data: { unitType: 'x', unitAmount: 1 } });
assert.equal(earned, 1);
lastShow().onEvent({ type: 'dismissed' });
assert.equal(await shown, 'rewarded');
assert.equal(opened, 1);
assert.equal(loadsOf('rewarded'), 5, 'the next ad is preloaded after a show');

// Earned, then an error: the reward is still the player's.
lastLoad('rewarded').onEvent({ type: 'loaded' });
shown = toss.show('rewarded', signal());
lastShow().onEvent({ type: 'impression' });
lastShow().onEvent({ type: 'userEarnedReward', data: { unitType: 'x', unitAmount: 1 } });
lastShow().onError(new Error('bridge'));
assert.equal(await shown, 'rewarded');

// `dismissed` never arrives: a touch on the page (after the opening tap) ends the ad.
lastLoad('rewarded').onEvent({ type: 'loaded' });
earned = 0;
let settledWith = null;
shown = toss.show('rewarded', signal(), undefined, () => earned++);
void shown.then((r) => (settledWith = r));
lastShow().onEvent({ type: 'show' });
lastShow().onEvent({ type: 'userEarnedReward', data: { unitType: 'x', unitAmount: 1 } });
window.dispatchEvent(new Event('pointerdown'));
await flush();
assert.equal(settledWith, null, 'a touch right after opening may be the opening tap');
advance(OPEN_GRACE_MS - 10);
window.dispatchEvent(new Event('pointerdown'));
await flush();
assert.equal(settledWith, null, 'still inside the grace');
advance(20);
window.dispatchEvent(new Event('pointerdown'));
assert.equal(await shown, 'rewarded', 'a lost dismissal does not lock the game or lose the reward');
assert.equal(earned, 1);

// The same for an interstitial: it closes, nothing is rewarded.
toss.ready('interstitial');
shown = toss.show('interstitial', signal());
lastShow().onEvent({ type: 'show' });
advance(OPEN_GRACE_MS + 1);
window.dispatchEvent(new Event('pointerdown'));
assert.equal(await shown, 'closed');

// Not earned and closed early: closed. A failed show: unavailable, and the slot reloads.
lastLoad('rewarded').onEvent({ type: 'loaded' });
shown = toss.show('rewarded', signal());
lastShow().onEvent({ type: 'show' });
lastShow().onEvent({ type: 'dismissed' });
assert.equal(await shown, 'closed');
lastLoad('rewarded').onEvent({ type: 'loaded' });
const loadsBefore = loadsOf('rewarded');
shown = toss.show('rewarded', signal());
lastShow().onEvent({ type: 'failedToShow' });
assert.equal(await shown, 'unavailable');
assert.equal(loadsOf('rewarded'), loadsBefore + 1);
// Nothing loaded: never calls the bridge.
const showsBefore = bridge.shows.length;
assert.equal(await toss.show('rewarded', signal()), 'unavailable');
assert.equal(bridge.shows.length, showsBefore);

// A show that fails synchronously still unsubscribes.
lastLoad('rewarded').onEvent({ type: 'loaded' });
globalThis.__ads.show = (o) => { o.onEvent({ type: 'failedToShow' }); return () => bridge.unregistered++; };
const unregBefore = bridge.unregistered;
assert.equal(await toss.show('rewarded', signal()), 'unavailable');
assert.equal(bridge.unregistered, unregBefore + 1);

toss.destroy();
assert.equal(due.size, 0, 'destroy clears every load timeout and retry');

globalThis.setTimeout = realTimers.set;
globalThis.clearTimeout = realTimers.clear;
Object.defineProperty(globalThis, 'performance', realPerf);
delete globalThis.__ads;
console.log('PASS: opening pads free, 75s gap incl. rewarded, persistence, no fill, errors, watchdog only before open, double tap, recovery, test/live ad groups, mock, release without ads, private storage, load back-off + timeout, earned reward kept on error / lost dismissal');

import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Policy timing only: the loader stubs the host SDK, so no real ad bridge can be touched.
const { AdPolicy, MockAdProvider, createAdProvider, FREE_PADS, MIN_GAP_MS, AD_GROUP_IDS, LIVE_ADS } = await load('ads/AdPolicy');
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

// Ad groups: dev/QA bundles never touch a live group.
assert.equal(LIVE_ADS, false);
for (const id of Object.values(AD_GROUP_IDS)) assert.ok(id.startsWith('ait-ad-test-'), id);
const live = await load('ads/AdPolicy', { VITE_PROMOTION_MODE: 'live' });
assert.equal(live.LIVE_ADS, true);
for (const id of Object.values(live.AD_GROUP_IDS)) assert.ok(id.startsWith('ait.v2.live.'), id);

assert.equal(new MockAdProvider().ready('interstitial'),false);
assert.ok(createAdProvider() instanceof MockAdProvider, 'no Toss host → mock provider');
const broken = {getItem:()=>{throw Error('private');},setItem:()=>{throw Error('private');}};
const privatePolicy = new AdPolicy(provider,()=>clock,broken);
assert.equal(await privatePolicy.next('rewarded',2),'rewarded');
console.log('PASS: opening pads free, 75s gap incl. rewarded, persistence, no fill, errors, watchdog only before open, double tap, recovery, test/live ad groups, mock, private storage');

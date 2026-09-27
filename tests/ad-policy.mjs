import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Policy timing only: the loader stubs the host SDK, so no real ad bridge can be touched.
const { AdPolicy, MockAdProvider, createAdProvider } = await load('ads/AdPolicy');
let clock = 1000, calls = 0;
const data = new Map();
const storage = {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};
const provider = {ready:()=>true,show:async kind=>{calls++;return kind==='rewarded'?'rewarded':'closed';}};
const p = new AdPolicy(provider,()=>clock,storage,20);
assert.equal(await p.next('interstitial',1),'unavailable');
assert.equal(calls,0);
assert.equal(await p.next('interstitial',2),'closed');
assert.equal(await p.next('interstitial',3),'unavailable');
assert.equal(await p.next('interstitial',4),'closed');
assert.equal(await p.next('rewarded',5),'rewarded');
assert.equal(await p.next('interstitial',6),'unavailable'); // skip the transition after a rewarded ad
assert.equal(await p.next('interstitial',7),'closed'); // two completed pads since that full-screen ad
const restored = new AdPolicy(provider,()=>clock,storage,20);
assert.equal(restored.eligible(8),false);
assert.equal(restored.eligible(9),true);
restored.provider = {ready:()=>false,show:()=>assert.fail('no fill must not show')};
assert.equal(await restored.next('interstitial',9),'unavailable');
assert.equal(restored.eligible(9),true,'no-fill does not consume the two-pad interval');
restored.provider = {ready:()=>true,show:async()=>{throw Error('network');}};
assert.equal(await restored.next('interstitial',9),'unavailable');
assert.equal(restored.eligible(9),true,'show failure does not consume the interval');
let aborted = false;
restored.provider = {ready:()=>true,show:(_,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}};
const pending = restored.next('interstitial',9);
assert.equal(await restored.next('interstitial',9),null);
assert.equal(await pending,'unavailable');
assert.equal(aborted,true);
restored.provider = provider;
assert.equal(await restored.next('interstitial',9),'closed'); // lock released after failure
assert.equal(new MockAdProvider().ready('interstitial'),false);
assert.ok(createAdProvider() instanceof MockAdProvider, 'no Toss host → mock provider');
const broken = {getItem:()=>{throw Error('private');},setItem:()=>{throw Error('private');}};
const privatePolicy = new AdPolicy(provider,()=>clock,broken);
assert.equal(await privatePolicy.next('rewarded',2),'rewarded');
console.log('PASS: first 2 pads, every-2-pads interval, reward suppression, persistence, no fill, errors, timeout/abort, double tap, recovery, mock, private storage');

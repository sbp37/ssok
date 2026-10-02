import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Policy timing only: the loader stubs the host SDK, so no real ad bridge can be touched.
const { AdPolicy, MockAdProvider, createAdProvider } = await load('ads/AdPolicy');
let clock = 1000, calls = 0;
const data = new Map();
const storage = {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};
const provider = {ready:()=>true,show:async kind=>{calls++;return kind==='rewarded'?'rewarded':'closed';}};
const p = new AdPolicy(provider,()=>clock,storage,20);
// The opening pad itself is free; its NEXT transition and every later one show an ad.
assert.equal(await p.next('interstitial',1),'closed');
assert.equal(await p.next('interstitial',2),'closed');
assert.equal(await p.next('interstitial',3),'closed');
assert.equal(await p.next('rewarded',4),'rewarded');
assert.equal(await p.next('interstitial',5),'closed'); // rewarded replaces one transition, not the following one
const restored = new AdPolicy(provider,()=>clock,storage,20);
assert.equal(restored.eligible(5),false);
assert.equal(restored.eligible(6),true);
restored.provider = {ready:()=>false,show:()=>assert.fail('no fill must not show')};
assert.equal(await restored.next('interstitial',6),'unavailable');
assert.equal(restored.eligible(6),true,'no-fill does not consume the next transition');
restored.provider = {ready:()=>true,show:async()=>{throw Error('network');}};
assert.equal(await restored.next('interstitial',6),'unavailable');
assert.equal(restored.eligible(6),true,'show failure does not consume the transition');
let aborted = false;
restored.provider = {ready:()=>true,show:(_,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}};
const pending = restored.next('interstitial',6);
assert.equal(await restored.next('interstitial',6),null);
assert.equal(await pending,'unavailable');
assert.equal(aborted,true);
restored.provider = provider;
assert.equal(await restored.next('interstitial',6),'closed'); // lock released after failure
assert.equal(new MockAdProvider().ready('interstitial'),false);
assert.ok(createAdProvider() instanceof MockAdProvider, 'no Toss host → mock provider');
const broken = {getItem:()=>{throw Error('private');},setItem:()=>{throw Error('private');}};
const privatePolicy = new AdPolicy(provider,()=>clock,broken);
assert.equal(await privatePolicy.next('rewarded',2),'rewarded');
console.log('PASS: opening play free, every NEXT transition, rewarded replacement, persistence, no fill, errors, timeout/abort, double tap, recovery, mock, private storage');

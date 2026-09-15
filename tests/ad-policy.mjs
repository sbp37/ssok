import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/game/ads/AdPolicy.ts', import.meta.url), 'utf8');
// This test exercises policy timing only. Stub the host SDK so the transpiled
// data URL stays self-contained in Node and cannot attempt a real ad bridge.
const isolatedSource = source.replace(
  'import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";',
  'const loadFullScreenAd = Object.assign(() => () => {}, {isSupported: () => false});\n' +
  'const showFullScreenAd = Object.assign(() => () => {}, {isSupported: () => false});',
);
const js = ts.transpileModule(isolatedSource, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
const {AdPolicy, MockAdProvider} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let clock = 1000, calls = 0;
const data = new Map();
const storage = {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};
const provider = {ready:()=>true,show:async kind=>{calls++;return kind==='rewarded'?'rewarded':'closed';}};
const p = new AdPolicy(provider,()=>clock,storage,20);
clock += 120000;
assert.equal(await p.next('interstitial',1),'unavailable');
assert.equal(calls,0);
assert.equal(await p.next('interstitial',2),'closed');
assert.equal(await p.next('interstitial',3),'unavailable');
clock += 120000;
assert.equal(await p.next('rewarded',3),'rewarded');
clock += 120000;
assert.equal(await p.next('interstitial',4),'unavailable'); // skip next even after a long play
assert.equal(await p.next('interstitial',5),'closed');
const restored = new AdPolicy(provider,()=>clock,storage,20);
assert.equal(restored.eligible(8),false);
clock += 120000;
assert.equal(restored.eligible(8),true);
restored.provider = {ready:()=>false,show:()=>assert.fail('no fill must not show')};
assert.equal(await restored.next('interstitial',8),'unavailable');
restored.provider = {ready:()=>true,show:async()=>{throw Error('network');}};
assert.equal(await restored.next('interstitial',8),'unavailable');
let aborted = false;
restored.provider = {ready:()=>true,show:(_,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}};
const pending = restored.next('interstitial',8);
assert.equal(await restored.next('interstitial',8),null);
assert.equal(await pending,'unavailable');
assert.equal(aborted,true);
restored.provider = provider;
assert.equal(await restored.next('interstitial',8),'closed'); // lock released after failure
assert.equal(new MockAdProvider().ready('interstitial'),false);
const broken = {getItem:()=>{throw Error('private');},setItem:()=>{throw Error('private');}};
const privatePolicy = new AdPolicy(provider,()=>clock,broken);
assert.equal(await privatePolicy.next('rewarded',2),'rewarded');
console.log('PASS: first pad, interval, reward suppression, persistence, no fill, errors, timeout/abort, double tap, recovery, mock, private storage');

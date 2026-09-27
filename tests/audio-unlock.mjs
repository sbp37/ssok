import assert from 'node:assert/strict';
import { loadFresh } from './load.mjs';

// Run the actual synth against a controllably suspended audio output. This
// reproduces a long first drag before mobile touchend permits audio playback.
let now = 0, context, starts;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ samples: {} }) });
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
function node(kind) {
  return { kind, gain:param(), frequency:param(), Q:param(), playbackRate:param(),
    threshold:param(), knee:param(), ratio:param(), attack:param(), release:param(),
    connect(target) { return target; }, disconnect() {},
    start(time=0) { assert(Number.isFinite(time)); starts.push(kind); }, stop() {} };
}
class AudioContext {
  state = 'suspended'; currentTime = 0; sampleRate = 48000; destination = node('output');
  constructor() { context = this; }
  resume() { return Promise.resolve(); } // does not unlock until the native gesture
  createGain() { return node('gain'); }
  createDynamicsCompressor() { return node('compressor'); }
  createBiquadFilter() { return node('filter'); }
  createOscillator() { return node('tone'); }
  createBufferSource() { return node('buffer'); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  activate() { this.state = 'running'; this.onstatechange?.(); }
}
globalThis.window = { AudioContext };
async function fresh() { now=0; starts=[]; return (await loadFresh('audio/Sfx')).sfx; }

for (const kind of ['ordinary','fiber','chain','rainbow','charm','peel','swirl','bubble']) {
  const sfx = await fresh();
  sfx.beginGesture(1);
  if (kind === 'ordinary') sfx.pop('pok',1);
  else sfx.tactileRelease(kind,1);
  now=5000; // previously discarded after 1500ms while the finger was still down
  sfx.endGesture(1);
  starts=[]; context.activate();
  assert(starts.length>0, `${kind}: first completion survives long held gesture`);
  const count=starts.length;
  sfx.unlock(); context.onstatechange?.();
  assert.equal(starts.length,count,'completion plays once, including repeated resume callbacks');
}
{
  const sfx=await fresh(); sfx.beginGesture(1); sfx.tactileStep('bubble',1);
  starts=[]; now=50; context.activate();
  assert(starts.length>0,'a fresh first tactile stage is not lost');
}
for (const clear of ['mute','cancel','destroy','stale-step','stale-pop','next-gesture']) {
  const sfx=await fresh(); sfx.beginGesture(1);
  if(clear==='stale-step') sfx.tactileStep('fiber',1); else sfx.pop('pok',1);
  if(clear==='mute') { sfx.setEnabled(false); sfx.setEnabled(true); }
  if(clear==='cancel') sfx.endGesture(1,true);
  if(clear==='destroy') sfx.cancelPending();
  if(clear==='stale-pop'||clear==='next-gesture') sfx.endGesture(1);
  now=5000;
  if(clear==='next-gesture') sfx.beginGesture(2);
  starts=[]; context.activate();
  assert.equal(starts.length,0,`${clear}: never replay stale/cancelled sound`);
}
{
  const sfx=await fresh(); sfx.beginGesture(1); sfx.tactileRelease('charm',1);
  sfx.tactileStep('fiber',1); starts=[]; context.activate();
  assert(starts.filter(x=>x==='tone').length>=2,'completion cannot be replaced by a drag cue');
}
console.log('PASS: first ordinary + all 7 tactile completions, delayed native unlock, one-shot replay, fresh/stale stages, mute/cancel/dispose');

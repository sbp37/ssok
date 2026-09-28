import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { generatePad } = await load('beads/Bead');
const { PADS } = await load('pads/PadTypes');
const { roundBeadBudget } = await load('pads/pacing');
const { Rng } = await load('util/math');
const { installFibers, FiberPull, fiberPoint, exposedFiber, relaxFiber, chainCount, chainFraction } = await load('fibers/Fiber');
for (const pad of PADS) for (const completed of [0,1,2,12]) {
  const budget=roundBeadBudget(pad.beads,completed);
  const expected=completed===0?17:completed===1?21:Math.round(pad.beads.surface*.42)+3;
  assert.equal(budget.surface+(pad.beads.smallFillZones?.length??0),expected,'three extra visible beads in each round budget');
  assert.equal(budget.maxTotal,completed===0?23:completed===1?27:31,'three extra total slots');
}
let rounds=0;
const fingerprint = b => [b.id,b.type.id,b.color,b.rx,b.ry,b.radius,b.rot,b.layer,b.slot,b.hidden];
for (const pad of PADS) for (const completed of [1,2,50]) for(let seed=1;seed<=30;seed++) {
  const rng = new Rng(seed);
  const beads = generatePad(170,rng,{...pad.beads,...roundBeadBudget(pad.beads,completed),
    boundary:pad.outline,hole:pad.hole,hiddenObject:'bigpearl',kingChance:1,ultraChance:1,deeperChance:.5});
  const n=beads.length;
  const candidates=beads.filter(b=>b.layer===0&&!b.hidden&&['common','big','odd'].includes(b.type.rarity)
    &&!beads.some(x=>x.layer===1&&x.slot===b.slot));
  const protectedBeads=beads.filter(b=>!candidates.includes(b));
  const before=protectedBeads.map(fingerprint);
  const fibers=installFibers(beads,170,rng);
  assert.equal(fibers.length,Math.min(3,candidates.length));
  assert.equal(beads.length,n,'no additional picks');
  assert.deepEqual(protectedBeads.map(fingerprint),before,'treasures and their hosts cannot change');
  assert.equal(new Set(fibers.map(b=>b.fiber.color)).size,fibers.length);
  for(const b of fibers) {
    const f=b.fiber;
    assert(f.length>20 && f.length<240);
    assert(f.path.every(p=>Math.hypot(p.x,p.y)<=f.radius),'buried yarn fits original slot');
    const pull=new FiberPull(b,f.tip.x,f.tip.y);
    const start={...f.tip};
    pull.move(start.x,start.y-25);
    const partial=f.pulled;
    assert(partial>0 && partial<f.length);
    for(let i=0;i<120;i++)pull.move(start.x,start.y-25);
    assert.equal(f.pulled,partial,'holding still never finishes');
    pull.move(start.x,start.y);assert.equal(f.pulled,partial,'moving back never loses progress');
    for(let i=0;i<60;i++)relaxFiber(f,1/60);
    assert.equal(f.pulled,partial,'release cannot put yarn back');
    const resume=new FiberPull(b,f.tip.x,f.tip.y);
    const resumedTip={...f.tip};
    assert(resume.move(resumedTip.x+10000,resumedTip.y),'one quick swipe can finish');
    assert.equal(f.pulled,f.length);
    assert(Math.hypot(f.tip.x-resumedTip.x,f.tip.y-resumedTip.y)<=f.length-partial+5.001,'no infinite stretch');
    const free=exposedFiber(f),root=fiberPoint(f);
    assert.deepEqual(free[0],root);
    assert(Math.hypot(free.at(-1).x-f.tip.x,free.at(-1).y-f.tip.y)<1e-6);
    assert(free.every(p=>Number.isFinite(p.x+p.y)));
  }
  rounds++;
}
console.log(`PASS: ${rounds} layouts / same total / protected treasure hosts / fitted geometry / pause + resume / no idle auto-pop / bounded fast swipe`);

const {roundTactile,installTactile,installOpeningTactiles,installRoundTactiles}=await load('fibers/Tactile');
for(const pad of PADS) for(let seed=1;seed<=30;seed++) {
  const rng=new Rng(seed),beads=generatePad(170,rng,{...pad.beads,...roundBeadBudget(pad.beads,0),
    boundary:pad.outline,hole:pad.hole,hiddenObject:'bigpearl',kingChance:1});
  const count=beads.length;
  const protectedBeads=beads.filter(b=>b.layer===1||b.hidden||!['common','big','odd'].includes(b.type.rarity)
    ||beads.some(x=>x.layer===1&&x.slot===b.slot));
  const before=protectedBeads.map(fingerprint);
  installOpeningTactiles(beads,170,rng);
  assert.equal(beads.filter(b=>b.fiber?.kind==='bubble').length,1,'first round includes one large air bubble');
  assert.equal(beads.filter(b=>b.fiber?.kind==='charm').length,1,'first round includes a charm strand');
  assert.equal(beads.filter(b=>b.fiber&&!b.fiber.kind).length,2,'first round includes two separate yarns');
  assert.equal(beads.length,count,'first round gains variety, not extra picks');
  assert.deepEqual(protectedBeads.map(fingerprint),before,'opening never overwrites treasure or hidden hosts');
}
console.log('PASS: opening bubble + charm + 2 yarns on all pad shapes / same count / protected treasures');
assert.equal(roundTactile(0),'charm','the opening pad has one short connected-bead surprise');
assert.deepEqual([1,2,3,4,5,6,7,8,9,10].map(roundTactile),['bubble','chain','swirl','rainbow','peel','swirl','bubble','charm','swirl','bubble']);
{
  const later=Array.from({length:90},(_,i)=>roundTactile(i+1));
  assert.equal(later.filter(k=>k==='swirl').length,30,'swirl on exactly one pad in three');
  for(let i=0;i+2<later.length;i++) assert.equal(later.slice(i,i+3).filter(k=>k==='swirl').length,1,'never two swirls within three pads');
  for(let i=0;i+9<=later.length;i++) for(const k of ['bubble','chain','rainbow','charm','peel'])
    assert(later.slice(i,i+9).includes(k),`${k} returns within any nine pads`);
}
for(const pad of PADS) for(const completed of [1,2,3,4,5,6,7,8,9]) for(let seed=1;seed<=15;seed++) {
  const rng=new Rng(seed),beads=generatePad(170,rng,{...pad.beads,...roundBeadBudget(pad.beads,completed),
    boundary:pad.outline,hole:pad.hole,hiddenObject:'bigpearl',kingChance:1,ultraChance:1,deeperChance:.5});
  const count=beads.length,featured=roundTactile(completed);
  const protectedBeads=beads.filter(b=>b.layer===1||b.hidden||!['common','big','odd'].includes(b.type.rarity)
    ||beads.some(x=>x.layer===1&&x.slot===b.slot));
  const before=protectedBeads.map(fingerprint);
  installRoundTactiles(beads,170,rng,featured,completed);
  assert.equal(beads.filter(b=>b.fiber&&!b.fiber.kind).length,1,'every later pad includes one yarn');
  assert.equal(beads.filter(b=>b.fiber?.kind===featured).length,1,'every later pad includes its featured texture');
  assert.equal(beads.length,count,'mixed textures never add pulls');
  assert.deepEqual(protectedBeads.map(fingerprint),before,'mixed textures preserve treasures and hidden hosts');
}
console.log('PASS: every later pad has 1 yarn + 1 featured texture / swirl every third pad / same count / protected treasures');
{
  // the one yarn of later pads varies with the completed count instead of always being the same pink strand
  const looks=new Set();
  for(let completed=1;completed<=12;completed++){
    const rng=new Rng(5),beads=generatePad(170,rng,{...PADS[0].beads,...roundBeadBudget(PADS[0].beads,completed),boundary:PADS[0].outline});
    const [y]=installFibers(beads,170,rng,1,completed);
    looks.add(y.fiber.color+'|'+y.fiber.length);
    assert(y.fiber.length>=118&&y.fiber.length<=165);
  }
  assert(new Set([...looks].map(l=>l.split('|')[0])).size===3,'all three yarn colours appear');
  assert(looks.size>=6,'colour and length combine into several different yarns');
}
console.log('PASS: later-pad yarn rotates colour, twist and length');
let treatments=0;
for(const kind of ['chain','rainbow','charm','peel']) for(const pad of PADS) for(let seed=1;seed<=30;seed++) {
  const rng=new Rng(seed),beads=generatePad(170,rng,{...pad.beads,...roundBeadBudget(pad.beads,2),
    boundary:pad.outline,hole:pad.hole,hiddenObject:'bigpearl',kingChance:1,ultraChance:1,deeperChance:.5});
  const before=beads.map(fingerprint),count=beads.length;
  const chosen=installTactile(beads,170,rng,kind);
  assert(chosen.length<=1,'one surprise per round');
  assert.equal(beads.length,count);
  assert.deepEqual(beads.map(fingerprint),before,'all bead IDs, rewards, radii, slots and treasure hosts preserved');
  for(const b of chosen) {
    assert(!beads.some(x=>x.slot===b.slot&&x.layer===1));
    const f=b.fiber;
    assert(f.path.every(p=>Math.hypot(p.x,p.y)<=f.radius));
    const start={...f.tip},pull=new FiberPull(b,start.x,start.y);
    const sign=-1;
    if(kind!=='peel') {
      assert.equal(chainCount(f),kind==='rainbow'?7:kind==='charm'?4:5);
      if(kind==='charm')assert.equal(chainFraction(f,3),.87,'large pendant stays buried until final stretch');
    }
    pull.move(start.x,start.y+38*sign);
    const partial=f.pulled;
    assert(partial>0&&partial<f.length);
    for(let i=0;i<120;i++)pull.move(start.x,start.y+38*sign);
    assert.equal(f.pulled,partial,'ratchets cannot advance from time alone');
    pull.move(start.x,start.y);
    assert.equal(f.pulled,partial,'moving back preserves progress');
    const tip={...f.tip};for(let i=0;i<60;i++)relaxFiber(f,1/60);
    if(kind==='peel')assert.deepEqual(f.tip,tip,'peeled flap remains accessible');
    const resume=new FiberPull(b,f.tip.x,f.tip.y),resumeStart={...f.tip};
    let previous=f.pulled;
    for(let d=0;d<240;d++) {
      resume.move(resumeStart.x,resumeStart.y+d*sign);
      assert(f.pulled>=previous,'no slipback');previous=f.pulled;
    }
    assert.equal(f.pulled,f.length,'slow steady dragging also completes');
  }
  treatments++;
}
console.log(`PASS: ${treatments} chain/rainbow/charm/peel layouts / free-direction peeling / alternating rounds / no new rewards or picks / gradual drag / no idle progression / resume`);

for(const direction of [-1,1]) for(const pad of PADS) {
 const rng=new Rng(91),beads=generatePad(170,rng,{...pad.beads,boundary:pad.outline,hole:pad.hole});
 const before=beads.map(fingerprint),[b]=installTactile(beads,170,rng,'swirl');
 assert.deepEqual(beads.map(fingerprint),before);
 if(!b)continue;
 const f=b.fiber,r=f.radius*.86,pull=new FiberPull(b,r,0);
 pull.move(r+300,0);assert.equal(f.pulled,0,'straight outward tug cannot unwind');
 for(let i=0;i<=30;i++){const a=direction*i/30*Math.PI;pull.move(Math.cos(a)*r,Math.sin(a)*r);}
 const partial=f.pulled;assert(Math.abs(partial-40)<1e-6);
 for(let i=0;i<100;i++)pull.move(-r,0);
 assert(Math.abs(f.pulled-partial)<1e-8,'holding still does not unwind');
 for(let i=30;i>=0;i--){const a=direction*i/30*Math.PI;pull.move(Math.cos(a)*r,Math.sin(a)*r);}
 assert(Math.abs(f.pulled-partial)<1e-8,'reversing or wiggling does not farm progress');
 const resume=new FiberPull(b,f.tip.x,f.tip.y),a0=Math.atan2(f.tip.y,f.tip.x);
 for(let i=1;i<=90;i++){const a=a0+direction*i/90*Math.PI*2;resume.move(Math.cos(a)*r,Math.sin(a)*r);}
 assert.equal(f.pulled,f.length,'either direction can resume and finish');
}
console.log('PASS: swirl clockwise/counterclockwise, radial no-op, reversal, idle, resume and catalogue preservation');

{
  const { BubblePress, BUBBLE_DOMES, BUBBLE_SQUEEZE } = await load('fibers/Bubble');
  let layouts=0;
  for(const pad of PADS) for(let seed=1;seed<=20;seed++) {
    const rng=new Rng(seed),beads=generatePad(170,rng,{...pad.beads,...roundBeadBudget(pad.beads,1),
      boundary:pad.outline,hole:pad.hole,hiddenObject:'bigpearl',kingChance:1,ultraChance:1,deeperChance:.5});
    const before=beads.map(fingerprint),count=beads.length;
    const [b]=installTactile(beads,170,rng,'bubble');
    assert.equal(beads.length,count,'the film adds no pulls');
    assert.deepEqual(beads.map(fingerprint),before,'bead, colour, slot, rewards and treasure hosts unchanged');
    if(!b) continue;
    layouts++;
    const f=b.fiber;
    assert.equal(BUBBLE_DOMES,1,'one large readable air cell');
    assert.equal(f.domes.length,BUBBLE_DOMES);
    assert.equal(f.length,BUBBLE_DOMES);
    assert(f.domes.every(d=>Math.hypot(d.x,d.y)+d.r<=f.radius*1.001),'domes stay on the film');
    assert(!beads.some(x=>x.slot===b.slot&&x.layer===1),'never over a buried treasure');
    const dome=f.domes[0];
    assert(dome.r>f.radius*.85,'the dome wraps the bead rather than looking like a tiny button');
    // cancelled squeeze springs back and preserves the unopened bead
    let press=new BubblePress(b,dome.x,dome.y);
    press.tick(BUBBLE_SQUEEZE*.5);assert(dome.squash>0&&dome.squash<1&&!dome.popped,'the dome visibly squashes before it goes');
    press.cancel();assert.equal(f.pulled,0);assert.equal(dome.squash,0);
    // one quick, forgiving tap opens the single cell
    press=new BubblePress(b,0,0);
    assert.equal(press.lift(),0);assert(press.complete,'one air-cell tap completes the wrapper');
    assert.equal(f.pulled,f.length);
    assert(dome.popped);
    assert.equal(press.lift(),-1,'the opened wrapper never completes twice');
  }
  assert(layouts>150,'the film finds a slot on nearly every pad');
  console.log(`PASS: single air-cell wrapper on ${layouts} layouts / no added bead or reward / squeeze, cancel, one-shot tap`);
}

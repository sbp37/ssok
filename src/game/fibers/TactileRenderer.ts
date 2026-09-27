import type { Bead } from "../beads/Bead";
import { BEAD_TYPES } from "../beads/BeadTypes";
import { getBeadSprite } from "../beads/BeadSprites";
import { chainCount, chainFraction, exposedFiber, fiberPoint, type FiberPoint } from "./Fiber";

type MapPoint = (p: FiberPoint) => FiberPoint;
const tiny = BEAD_TYPES.find(b => b.id === "tiny")!;
const colors = ["#f394bc", "#75d5c3", "#c4a0ed", "#ffcb75", "#a7deef"];
function pearl(ctx: CanvasRenderingContext2D, p: FiberPoint, r: number, i: number, dpr: number, pendant?: Bead) {
  const sp = getBeadSprite(pendant?.type ?? tiny, pendant?.color ?? colors[i % colors.length], Math.round(r * 2) / 2, dpr);
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(pendant?.rot ?? i*.37);
  ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);ctx.restore();
}

/** A single connected five-bead strand. Submerged beads emerge successively. */
export function drawChain(ctx: CanvasRenderingContext2D, b: Bead, map: MapPoint, scale: number, dpr: number, removed: boolean) {
  const f = b.fiber!, count = chainCount(f);
  const u = f.pulled / f.length;
  ctx.save();ctx.lineCap = ctx.lineJoin = "round";
  if (removed) {
    ctx.strokeStyle = "rgba(124,92,131,.16)";ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();f.path.forEach((p, i) => { const q = map(p);i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y); });ctx.stroke();
    ctx.restore();return;
  }
  const free = exposedFiber(f);
  const positions = Array.from({length:count}, (_, i) => {
    const v = chainFraction(f,i);
    if (v <= u && u > 0) {
      const j = Math.max(0, Math.min(free.length - 1, Math.round((1 - v / u) * (free.length - 1))));
      return map(free[j]);
    }
    return map(fiberPoint(f, v));
  });
  ctx.strokeStyle = "rgba(166,128,147,.5)";ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();positions.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));ctx.stroke();
  const baseAlpha = ctx.globalAlpha;
  positions.forEach((p, i) => {
    const emerged = i === 0 || chainFraction(f,i) <= u;
    const pendant = f.kind === "charm" && i === count-1;
    const size = f.kind === "rainbow" ? [.8,1,.85,1.12,.82,1.05,.92][i] : 1;
    const reveal = Math.max(0, Math.min(1, (u - .82) / .12));
    const radius = pendant ? f.radius * (.4 + reveal * .68) * scale : Math.min(7.8,f.radius*.31)*scale*size;
    ctx.globalAlpha = baseAlpha * (emerged ? 1 : .42);
    pearl(ctx,p,radius,i,dpr,pendant?b:undefined);
    if (!emerged) {
      ctx.strokeStyle = "rgba(255,255,255,.65)";ctx.lineWidth = .9 * scale;
      ctx.beginPath();ctx.arc(p.x,p.y,radius+.7, .1, Math.PI*.85);ctx.stroke();
    }
  });
  ctx.restore();
}

export function drawChainCoil(ctx: CanvasRenderingContext2D, b: Bead, radius: number, dpr: number, curl = 1) {
  const f = b.fiber!, count = chainCount(f);
  const points = Array.from({length:count}, (_, i) => {
    const a = i / count * Math.PI * 2 - Math.PI / 2;
    const ring = f.kind === "charm" && i === count-1 ? .26 : .65;
    const target = {x:Math.cos(a) * radius * ring, y:Math.sin(a) * radius * ring};
    const from = f.released?.[Math.round((1 - chainFraction(f,i)) * 64)];
    return from && curl < 1 ? {x:from.x * radius / f.radius * (1-curl)+target.x*curl,
      y:from.y * radius / f.radius * (1-curl)+target.y*curl} : target;
  });
  ctx.save();ctx.strokeStyle = "#dac0ce";ctx.lineWidth = Math.max(.7,radius*.07);
  ctx.beginPath();points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));ctx.stroke();
  points.forEach((p,i) => {
    const pendant = f.kind === "charm" && i === count-1;
    pearl(ctx,p,radius*(pendant ? .7 : count===7 ? .23 : .28),i,dpr,pendant?b:undefined);
  });ctx.restore();
}

/** A wound gel ribbon loosens around the existing bead, not a new reward. */
export function drawSwirl(ctx: CanvasRenderingContext2D, b: Bead, map: MapPoint, scale: number, dpr: number) {
  const f=b.fiber!,u=f.pulled/f.length,c=map({x:0,y:0}),r=f.radius*scale;
  ctx.save();ctx.lineCap=ctx.lineJoin="round";
  const baseAlpha=ctx.globalAlpha;
  ctx.globalAlpha=baseAlpha*(.42+.58*u);
  pearl(ctx,c,b.radius*(.6+.16*u),0,dpr,b);ctx.globalAlpha=baseAlpha;
  const trace=()=>{
    ctx.beginPath();
    const angle=Math.atan2(f.tip.y,f.tip.x);
    for(let i=0;i<=64;i++){
      const t=i/64,a=angle+t*Math.PI*4*(1-u),rad=Math.hypot(f.tip.x,f.tip.y)*(1-t)+f.radius*.18*t;
      const p=map({x:Math.cos(a)*rad,y:Math.sin(a)*rad});
      i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);
    }
  };
  ctx.globalAlpha=baseAlpha*(1-u*.7);
  trace();ctx.lineWidth=Math.max(2,r*.19);ctx.strokeStyle="#82b5ba";ctx.stroke();
  trace();ctx.lineWidth=Math.max(1,r*.12);ctx.strokeStyle="#c3eee5";ctx.stroke();
  ctx.save();ctx.translate(-.7*scale,-.8*scale);trace();ctx.lineWidth=.85*scale;ctx.strokeStyle="#f4fffa";ctx.stroke();ctx.restore();
  ctx.globalAlpha=baseAlpha;
  const tip=map(f.tip);
  ctx.beginPath();ctx.arc(tip.x,tip.y,5*scale,0,Math.PI*2);ctx.fillStyle="#f7fffb";ctx.fill();ctx.lineWidth=1.3*scale;ctx.strokeStyle="#5d9ca5";ctx.stroke();
  ctx.restore();
}

/** Opaque milky attached area -> curved peeling edge -> translucent lifted flap.
 * The bead is the existing allocated object, with its original colour and ID. */
export function drawPeel(ctx: CanvasRenderingContext2D, b: Bead, map: MapPoint, scale: number, dpr: number) {
  const f = b.fiber!, r = f.radius, u = f.pulled / f.length;
  const centre = map({x:0,y:0});
  ctx.save();
  const sp = getBeadSprite(b.type,b.color,Math.round(b.radius * .76 * 2)/2,dpr);
  ctx.save();ctx.translate(centre.x,centre.y);ctx.rotate(b.rot);
  ctx.drawImage(sp.canvas,-sp.w/2,-sp.h/2,sp.w,sp.h);ctx.restore();
  const disc = () => {
    ctx.beginPath();
    for (let i=0;i<=64;i++) {
      const a=i/64*Math.PI*2, q=map({x:Math.cos(a)*r*.98,y:Math.sin(a)*r*.98});
      i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y);
    }
    ctx.closePath();
  };
  const foldY = r * (.94 - u * 1.88);
  const width = Math.sqrt(Math.max(0,r*r*.98*.98-foldY*foldY));
  const left=map({x:-width,y:foldY}), right=map({x:width,y:foldY});
  ctx.save();disc();ctx.clip();
  const top=map({x:0,y:-r});
  ctx.beginPath();ctx.moveTo(left.x,left.y);
  ctx.lineTo(centre.x-r*scale*1.4,centre.y-r*scale*2);
  ctx.lineTo(centre.x+r*scale*1.4,centre.y-r*scale*2);ctx.lineTo(right.x,right.y);ctx.closePath();
  const film=ctx.createLinearGradient(centre.x-r*scale,top.y,centre.x+r*scale,centre.y+r*scale);
  film.addColorStop(0,"rgba(249,255,250,.96)");film.addColorStop(.5,"rgba(190,232,218,.88)");film.addColorStop(1,"rgba(161,205,202,.92)");
  ctx.fillStyle=film;ctx.fill();ctx.restore();
  // The original soft flap lifts from the lower edge; no directional arrow.
  disc();ctx.strokeStyle="rgba(255,255,255,.72)";ctx.lineWidth=1.1*scale;ctx.stroke();
  const tip=map(f.tip);
  const bend=u>0 ? Math.min(12,u*25)*scale : 3*scale;
  const flap=ctx.createLinearGradient(left.x,left.y,tip.x,tip.y);
  flap.addColorStop(0,"rgba(137,193,183,.84)");flap.addColorStop(.16,"rgba(255,255,255,.95)");
  flap.addColorStop(.42,"rgba(205,246,228,.8)");flap.addColorStop(1,"rgba(233,255,242,.65)");
  ctx.beginPath();ctx.moveTo(left.x,left.y);
  ctx.bezierCurveTo(left.x,left.y-bend,tip.x-12*scale,tip.y-bend,tip.x-5*scale,tip.y);
  ctx.quadraticCurveTo(tip.x,tip.y+5*scale,tip.x+5*scale,tip.y);
  ctx.bezierCurveTo(tip.x+12*scale,tip.y-bend,right.x,right.y-bend,right.x,right.y);
  ctx.quadraticCurveTo(centre.x,(left.y+right.y)/2-bend,left.x,left.y);
  ctx.fillStyle=flap;ctx.fill();ctx.strokeStyle="rgba(255,255,255,.9)";ctx.lineWidth=1*scale;ctx.stroke();
  ctx.beginPath();ctx.moveTo(left.x,left.y+1*scale);ctx.quadraticCurveTo(centre.x,(left.y+right.y)/2-bend,right.x,right.y+1*scale);
  ctx.strokeStyle="rgba(81,143,131,.28)";ctx.lineWidth=2*scale;ctx.stroke();
  ctx.restore();
}

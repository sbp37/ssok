import type { Bead } from "../beads/Bead";
import { getBeadSprite, getShadowSprite } from "../beads/BeadSprites";

interface Item {
  bead: Bead;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vrot: number;
  asleep: number;
}

/**
 * Small transparent cup, bottom-right. Collected beads get a cheap circle
 * physics so they roll and settle; only the newest ~28 stay awake.
 */
export class Collector {
  x = 0;
  y = 0;
  w = 96;
  h = 76;
  items: Item[] = [];
  count = 0;
  /** squash impulse when something lands */
  bump = 0;

  layout(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  /** entry point in canvas coords (top centre of the cup) */
  get entry() {
    return { x: this.x + this.w / 2, y: this.y - 10 };
  }

  clear() {
    this.items = [];
    this.count = 0;
  }

  add(bead: Bead, vx: number, vy: number) {
    const r = Math.min(bead.radius * 0.72, this.w * 0.14);
    this.items.push({
      bead,
      x: this.x + this.w / 2 + (Math.random() - 0.5) * this.w * 0.5,
      y: this.y + 4,
      vx: vx * 0.15 + (Math.random() - 0.5) * 40,
      vy: Math.max(60, vy * 0.2),
      r,
      rot: bead.rot,
      vrot: (Math.random() - 0.5) * 6,
      asleep: 0,
    });
    this.count++;
    this.bump = 1;
    // nudge neighbours: tiny roll
    for (const it of this.items) if (it !== this.items[this.items.length - 1]) it.vx += (Math.random() - 0.5) * 18;
    if (this.items.length > 60) this.items.splice(0, this.items.length - 60);
  }

  step(dt: number) {
    this.bump = Math.max(0, this.bump - dt * 6);
    const g = 1500;
    const floor = this.y + this.h - 5;
    const left = this.x + 6;
    const right = this.x + this.w - 6;
    const awake = this.items.slice(-28);
    for (const it of awake) {
      it.vy += g * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vrot * dt;
      it.vx *= 0.985;
      it.vrot *= 0.97;
      if (it.y + it.r > floor) {
        it.y = floor - it.r;
        it.vy *= -0.18;
        it.vx *= 0.8;
        if (Math.abs(it.vy) < 20) it.vy = 0;
      }
      if (it.x - it.r < left) {
        it.x = left + it.r;
        it.vx *= -0.4;
      }
      if (it.x + it.r > right) {
        it.x = right - it.r;
        it.vx *= -0.4;
      }
    }
    // separation
    for (let i = 0; i < awake.length; i++) {
      const a = awake[i];
      for (let j = 0; j < this.items.length; j++) {
        const b = this.items[j];
        if (a === b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d < min) {
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          if (awake.includes(b)) {
            b.x += nx * push;
            b.y += ny * push;
          }
          a.vx -= nx * push * 6;
          a.vy -= ny * push * 6;
          a.vrot += nx * 0.4;
        }
      }
      if (a.y + a.r > floor) a.y = floor - a.r;
      if (a.x - a.r < left) a.x = left + a.r;
      if (a.x + a.r > right) a.x = right - a.r;
    }
  }

  draw(ctx: CanvasRenderingContext2D, dpr: number) {
    const { x, y, w, h } = this;
    const sq = 1 + this.bump * 0.04;
    ctx.save();
    ctx.translate(x + w / 2, y + h);
    ctx.scale(1 / Math.sqrt(sq), sq);
    ctx.translate(-(x + w / 2), -(y + h));
    // cup body: glassy
    const rr = 14;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + w - 4, y);
      ctx.lineTo(x + w, y + h - rr);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      ctx.lineTo(x + rr, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      ctx.closePath();
    };
    // shadow
    ctx.fillStyle = "rgba(90,70,90,0.10)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 3, w * 0.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    path();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();
    ctx.save();
    path();
    ctx.clip();
    // beads
    for (const it of this.items) {
      const sh = getShadowSprite(it.r, dpr);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(sh.canvas, it.x - sh.w / 2, it.y - sh.h / 2 + it.r * 0.35, sh.w, sh.h);
      ctx.globalAlpha = 1;
      const sp = getBeadSprite(it.bead.type, it.bead.color, it.r, dpr);
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.restore();
    }
    // glass tint over beads
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "rgba(255,255,255,0.28)");
    g.addColorStop(0.5, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(200,200,215,0.18)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    path();
    ctx.strokeStyle = "rgba(120,110,125,0.35)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // rim highlight
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 1);
    ctx.lineTo(x + w - 6, y + 1);
    ctx.stroke();
    ctx.restore();
  }
}

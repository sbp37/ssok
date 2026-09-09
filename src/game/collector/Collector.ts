import type { Bead } from "../beads/Bead";
import { getBeadSprite, getShadowSprite } from "../beads/BeadSprites";
import { jarLayers, preloadJar } from './JarAsset';

interface Item {
  bead: Bead;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vrot: number;
  /** settled: excluded from gravity, separation and rotation until something wakes it */
  sleeping: boolean;
  /** seconds spent slow enough to count as settling */
  settleT: number;
  /** position at the start of the frame – settling is judged on real movement */
  px: number;
  py: number;
  prot: number;
  /** seconds spent in contact with something – a bead jammed in a full jar is put to sleep anyway */
  awakeT: number;
  /** touched the floor or another bead this frame */
  touched: boolean;
  /** how many sleeping neighbours this item may still wake (only a falling bead has any) */
  wakeBudget: number;
}

/**
 * Settling is judged on how far a bead actually moved, not on its velocity:
 * a bead resting in a pile still gets a fresh tick of gravity every frame that
 * the contact then cancels, so its velocity never reads as zero even though it
 * is visibly still. (px/s, rad/s)
 */
const SLEEP_MOVE = 14;
const SLEEP_SPIN = 0.8;
/** how long it must stay that still before it snaps to a full stop */
const SLEEP_DELAY = 0.15;
/** overlap this small is left alone – correcting it forever is what makes a pile simmer */
const SLOP = 0.4;
/**
 * Hard stop. A nearly full jar is a jammed pack of discs; a bead can creep
 * along the pile indefinitely without ever meeting the stillness test. The jar
 * going quiet matters more than the last millimetre of realism, so anything
 * still awake after this simply lies down.
 */
const MAX_AWAKE = 0.5;

/**
 * Small transparent cup, bottom-right.
 *
 * A bead drops in, nudges the two or three beads it actually lands on, and
 * everything is still again within ~half a second. Settled beads are properly
 * asleep — no gravity, no separation, no rotation — so the jar never simmers
 * on its own; only an incoming bead can wake a few neighbours, and only the
 * ones it touches.
 */
export class Collector {
  constructor() { void preloadJar(); }
  x = 0;
  y = 0;
  w = 96;
  h = 76;
  items: Item[] = [];
  count = 0;
  /** jar squash when something lands, 0..1, gone in ~200ms */
  bump = 0;
  /** >0 while the jar is being tidied for a new pad (seconds elapsed) */
  private dismissT = -1;
  static readonly DISMISS = 0.28;
  /** beads are drawn a bit smaller than on the pad – it reads as depth – sized so a pad's worth (≈55) fills the jar */
  static readonly BEAD_SCALE = 0.76;
  static readonly MAX_ITEMS = 100; // above any pad's plain-bead count (max seen: 94) – nothing is ever silently dropped mid-pad

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

  /** true while anything is still moving – lets callers skip the step entirely */
  get settled() {
    if (this.bump > 0 || this.dismissing) return false;
    for (const it of this.items) if (!it.sleeping) return false;
    return true;
  }

  private wake(it: Item, vx = 0, vy = 0, vrot = 0) {
    it.sleeping = false;
    it.settleT = 0;
    it.awakeT = 0;
    it.touched = false;
    it.vx += vx;
    it.vy += vy;
    it.vrot += vrot;
  }

  /** tidy the jar away over ~280ms (beads sink a little and fade), then clear */
  dismiss() {
    if (this.items.length === 0) return;
    this.dismissT = 0;
  }
  get dismissing() {
    return this.dismissT >= 0;
  }

  add(bead: Bead, vx: number, vy: number) {
    if (this.dismissing) {
      // a straggler landing mid-tidy: finish the tidy first
      this.items = [];
      this.dismissT = -1;
    }
    const r = Math.min(bead.radius * Collector.BEAD_SCALE, this.w * 0.11);
    this.items.push({
      bead,
      x: this.x + this.w / 2 + (Math.random() - 0.5) * this.w * 0.5,
      y: this.y + 4,
      vx: vx * 0.15 + (Math.random() - 0.5) * 40,
      vy: Math.max(60, vy * 0.2),
      r,
      rot: bead.rot,
      vrot: (Math.random() - 0.5) * 6,
      sleeping: false,
      settleT: 0,
      awakeT: 0,
      touched: false,
      px: 0,
      py: 0,
      prot: 0,
      // only what it lands on gets disturbed, and only a handful
      wakeBudget: 4,
    });
    this.count++;
    this.bump = 1;
    if (this.items.length > Collector.MAX_ITEMS) this.items.splice(0, this.items.length - Collector.MAX_ITEMS);
  }

  step(dt: number) {
    this.bump = Math.max(0, this.bump - dt * 5); // ~200ms
    if (this.dismissT >= 0) {
      this.dismissT += dt;
      if (this.dismissT >= Collector.DISMISS) {
        this.items = [];
        this.dismissT = -1;
      }
      return;
    }
    const items = this.items;
    // nothing to do once every bead has settled
    let anyAwake = false;
    for (const it of items)
      if (!it.sleeping) {
        anyAwake = true;
        break;
      }
    if (!anyAwake) return;

    const g = 1500;
    const floor = this.y + this.h - 5;
    const left = this.x + 6;
    const right = this.x + this.w - 6;

    // 1. integrate the awake ones
    for (const it of items) {
      if (it.sleeping) continue;
      it.px = it.x;
      it.py = it.y;
      it.prot = it.rot;
      it.touched = false;
      it.vy += g * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vrot * dt;
      it.vx *= 0.9;
      it.vrot *= 0.9;
      if (it.y + it.r > floor) {
        it.touched = true;
        it.y = floor - it.r;
        it.vy *= -0.15;
        it.vx *= 0.7;
        if (Math.abs(it.vy) < 30) it.vy = 0;
      }
      if (it.x - it.r < left) {
        it.x = left + it.r;
        it.vx *= -0.35;
      }
      if (it.x + it.r > right) {
        it.x = right - it.r;
        it.vx *= -0.35;
      }
    }

    // 2. contacts, one pass. Resolve the overlap *and* the normal velocity —
    //    without the velocity half, gravity keeps piling into a bead that rests
    //    on another one and it can never settle. A sleeping bead is immovable:
    //    the awake one slides off it. Landing on one wakes it, but only a few,
    //    only on a real impact, and only softly.
    for (const a of items) {
      if (a.sleeping) continue;
      for (const b of items) {
        if (a === b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = min - d;
        a.touched = true;
        if (!b.sleeping) b.touched = true;
        // closing speed along the contact normal (positive = a moving into b)
        const vn = b.sleeping
          ? a.vx * nx + a.vy * ny
          : (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // only push out the part beyond the slop, and only most of the way
        const corr = Math.max(0, overlap - SLOP) * 0.8;
        if (b.sleeping) {
          a.x -= nx * corr;
          a.y -= ny * corr;
          if (vn > 0) {
            const j = vn * 1.06; // kill it, with a whisper of bounce
            a.vx -= nx * j;
            a.vy -= ny * j;
            // sliding across the contact bleeds into spin, and is damped
            const tv = -ny * a.vx + nx * a.vy;
            a.vrot += tv * 0.0025;
            a.vx -= -ny * tv * 0.5;
            a.vy -= nx * tv * 0.5;
          }
          // a real landing, not a graze → shift that neighbour a little
          if (a.wakeBudget > 0 && vn > 30) {
            a.wakeBudget--;
            this.wake(b, nx * 13, ny * 4, (Math.random() - 0.5) * 0.8);
          }
        } else {
          const push = corr * 0.5;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          if (vn > 0) {
            const j = vn * 0.54;
            a.vx -= nx * j;
            a.vy -= ny * j;
            b.vx += nx * j;
            b.vy += ny * j;
            a.vrot += (-ny * a.vx + nx * a.vy) * 0.0025;
          }
        }
      }
    }

    // 3. clamp, then settle: slow for long enough → hard stop
    for (const it of items) {
      if (it.sleeping) continue;
      if (it.y + it.r > floor) it.y = floor - it.r;
      if (it.x - it.r < left) it.x = left + it.r;
      if (it.x + it.r > right) it.x = right - it.r;
      const moved = Math.hypot(it.x - it.px, it.y - it.py) / dt;
      const spun = Math.abs(it.rot - it.prot) / dt;
      const still = moved < SLEEP_MOVE && spun < SLEEP_SPIN;
      it.settleT = still ? it.settleT + dt : 0;
      // only count time once it is actually resting on something; a bead still
      // falling in from the top must not be frozen in mid-air
      it.awakeT = it.touched ? it.awakeT + dt : 0;
      if (it.settleT >= SLEEP_DELAY || it.awakeT >= MAX_AWAKE) {
        it.vx = 0;
        it.vy = 0;
        it.vrot = 0;
        it.sleeping = true;
        it.wakeBudget = 0;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, dpr: number) {
    const { x, y, w, h } = this;
    const glass = jarLayers(w, h, dpr);
    // gentle, quick squash; ease it out so the tail is invisible
    const sq = 1 + this.bump * this.bump * 0.016;
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
    if (glass) ctx.drawImage(glass.back, x, y, w, h);
    else {
      path();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
    }
    ctx.save();
    path();
    ctx.clip();
    // beads (while tidying: they sink ~10px and fade – no shake, no spin)
    const k = this.dismissT >= 0 ? Math.min(1, this.dismissT / Collector.DISMISS) : 0;
    const sink = k * k * 10;
    const fade = 1 - k;
    for (const it of this.items) {
      const sh = getShadowSprite(it.r, dpr);
      ctx.globalAlpha = 0.5 * fade;
      ctx.drawImage(sh.canvas, it.x - sh.w / 2, it.y - sh.h / 2 + it.r * 0.35 + sink, sh.w, sh.h);
      ctx.globalAlpha = fade;
      const sp = getBeadSprite(it.bead.type, it.bead.color, it.r, dpr);
      ctx.save();
      ctx.translate(it.x, it.y + sink);
      ctx.rotate(it.rot);
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (glass) {
      ctx.restore(); // bead clip
      ctx.drawImage(glass.front, x, y, w, h);
      ctx.restore(); // jar bump transform
      return;
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

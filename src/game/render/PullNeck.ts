import type { Bead } from "../beads/Bead";
import type { Gel } from "../gel/Gel";
import type { Pull } from "../physics/pull";

export interface NeckInput {
  gel: Gel;
  bead: Bead;
  pull: Pull;
  /** the bead's *visible* radius: a big object in a small hole starts hole-sized and the hole stretches with it */
  r: number;
  /** the rigid bead's drawn centre (pad space), shared with the bead sprite and the first flight frame */
  centre: { x: number; y: number };
  /** pad scale (gel.R / REF_PAD_R) */
  s: number;
  dpr: number;
}

/**
 * Draws the gel around a bead that is being pulled: tent, oval lip, the moving
 * opening, the neck in the slip stage, and gel clinging to the bead's back.
 * Owns one reusable scratch surface for the neck so a pull never allocates canvases.
 */
export class PullNeckRenderer {
  private surface: HTMLCanvasElement | null = null;
  private tmp = { x: 0, y: 0 };

  /**
   * The gel holding a bead that is being pulled. Driven by *tension* and the
   * gel stretch vector, not by how far the bead has moved – in the grip stage
   * the bead sits still while the meniscus goes oval toward the finger and the
   * surface tents; only in the slip stage does a thinning neck appear.
   */
  draw(ctx: CanvasRenderingContext2D, { gel, bead: b, pull, r, centre, s, dpr }: NeckInput) {
    const T = pull.tension;
    const P = pull.progress;
    if (T < 0.02) return;
    gel.warp(b.rx, b.ry, this.tmp);
    const hx = this.tmp.x;
    const hy = this.tmp.y;
    const stx = pull.stretch.x;
    const sty = pull.stretch.y;
    const L = Math.hypot(stx, sty);
    const ux = L > 0.5 ? stx / L : pull.dirX;
    const uy = L > 0.5 ? sty / L : pull.dirY;
    const nx = -uy;
    const ny = ux;
    const bx = centre.x;
    const by = centre.y;
    const offX = bx - hx, offY = by - hy;
    const offL = Math.hypot(offX, offY);
    // big beads drag more gel with them: wider tent, thicker neck; while wedged the strain shows
    const J = pull.jam;
    const O = pull.over;
    const sizeStrength = pull.sizeStrength;
    const bigK = 1 + 0.35 * J + 0.25 * J * O;

    // ── tent: surface around the socket lifted toward the finger.
    // dark on the far side (steep, in shadow), bright bulge on the near side.
    ctx.save();
    gel.outlinePath(ctx);
    ctx.clip("evenodd");
    const tentR = r * (1.7 + 0.8 * T + 0.4 * P) * bigK;
    const far = ctx.createRadialGradient(hx - ux * r * 0.6, hy - uy * r * 0.6, r * 0.4, hx - ux * r * 0.3, hy - uy * r * 0.3, tentR);
    far.addColorStop(0, gel.col(0.19 * T * (1 + 0.6 * J * O), 0.35));
    far.addColorStop(0.5, gel.col(0.055 * T * (1 + 0.6 * J * O), 0.25));
    far.addColorStop(1, "rgba(55,45,58,0)");
    ctx.fillStyle = far;
    ctx.beginPath();
    ctx.arc(hx, hy, tentR, 0, Math.PI * 2);
    ctx.fill();
    const nearX = hx + ux * (r * 0.9 + L * 0.8);
    const nearY = hy + uy * (r * 0.9 + L * 0.8);
    const near = ctx.createRadialGradient(nearX, nearY, 0, nearX, nearY, tentR * 0.75);
    near.addColorStop(0, `rgba(255,255,255,${0.26 * T})`);
    near.addColorStop(0.5, `rgba(255,255,255,${0.08 * T})`);
    near.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = near;
    ctx.beginPath();
    ctx.arc(nearX, nearY, tentR * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── oval meniscus: the gel lip gripping the bead is dragged a little toward the finger.
    // Soft gradient rings (no hard strokes) drawn in a scaled space so they are elliptical.
    const cx = hx + ux * L * 0.06;
    const cy = hy + uy * L * 0.06;
    // Larger beads visibly open the mouth as they emerge, then the existing
    // socket/recoil takes over at POP. No permanent enlargement of the hole.
    const opening = sizeStrength * Math.sin(P * Math.PI * 0.8);
    const across = r * (1.12 - 0.1 * P + opening * 0.18);
    // Keep the mouth at its socket. Stretch belongs to the neck, not a giant
    // white oval that follows the bead and floats above the pad like a halo.
    const along = across + Math.min(r * 0.20, L * 0.12);
    const rot = Math.atan2(uy, ux);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(along / across, 1);
    // Gradients with an inner radius still fill the centre with stop zero.
    // Explicitly exclude it: the silicone lip is an annulus, not a pale disc.
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.5, 0, Math.PI * 2);
    ctx.arc(0, 0, across * 0.94, 0, Math.PI * 2, true);
    ctx.clip("evenodd");
    // glossy stretched surface just outside the bead
    const gloss = ctx.createRadialGradient(0, 0, across * 0.8, 0, 0, across * 1.5);
    gloss.addColorStop(0, `rgba(255,255,255,${0.1 + 0.12 * T})`);
    gloss.addColorStop(0.5, `rgba(255,255,255,${0.05 * T})`);
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // contact shadow ring outside the lip
    const ao = ctx.createRadialGradient(0, 0, across * 1.02, 0, 0, across * 1.42);
    ao.addColorStop(0, `rgba(55,45,58,${0.16 + 0.08 * T})`);
    ao.addColorStop(0.45, `rgba(55,45,58,${0.05 + 0.03 * T})`);
    ao.addColorStop(1, "rgba(55,45,58,0)");
    ctx.fillStyle = ao;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.42, 0, Math.PI * 2);
    ctx.fill();
    // the lip: bright thin ring, brighter toward the finger
    const lip = ctx.createRadialGradient(0, 0, across * 0.94, 0, 0, across * 1.22);
    lip.addColorStop(0, "rgba(255,255,255,0)");
    lip.addColorStop(0.35, `rgba(255,255,255,${(0.42 + 0.3 * T) * (1 - sizeStrength * 0.25)})`);
    lip.addColorStop(0.7, `rgba(255,255,255,${0.12 + 0.08 * T})`);
    lip.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lip;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.22, 0, Math.PI * 2);
    ctx.fill();
    // finger-side of the lip catches more light
    const side = ctx.createLinearGradient(-across, 0, across, 0);
    side.addColorStop(0, "rgba(255,255,255,0)");
    side.addColorStop(0.6, "rgba(255,255,255,0)");
    side.addColorStop(1, `rgba(255,255,255,${0.35 * T})`);
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.arc(0, 0, across * 1.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // One shaped opening, never an extra circular stain behind a heart/star.
    const holeR = r * (0.9 + 0.12 * P + opening * 0.16);
    gel.drawSocket(ctx, hx, hy, holeR, b.type, b.rot, 0.7 + T * 0.2 + P * 0.15);

    // ── neck (slip stage): a concave bridge from the lip to the bead that thins as it goes.
    // A big bead shows its neck sooner and keeps it thicker; a wedged one bulges mid-neck.
    // The strand is narrower than the bead at both ends (it was a triangle when its base
    // spanned the whole lip) and has a waist that thins as the bead comes out.
    if (offL > r * (0.45 - 0.12 * J)) {
      // Fade the whole bridge into its root, including its side reflections.
      // Fading only the body left a hard, pale cut edge over the socket.
      const target = ctx;
      const surface = this.surface ??= document.createElement('canvas');
      const pixelRatio = Math.min(2, dpr);
      const left = Math.min(hx, bx) - r * 1.5 - 12;
      const top = Math.min(hy, by) - r * 1.5 - 12;
      const width = Math.abs(offX) + r * 3 + 24;
      const height = Math.abs(offY) + r * 3 + 24;
      // Reuse a power-of-two scratch surface; no per-frame resize/upload.
      const side = 2 ** Math.ceil(Math.log2(Math.max(width, height) * pixelRatio));
      if (surface.width < side || surface.height < side) surface.width = surface.height = side;
      ctx = surface.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, surface.width, surface.height);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, -left * pixelRatio, -top * pixelRatio);
      const kingWidth = b.type.id === "king" ? 1 : 0;
      const w0 = r * (0.72 + 0.1 * J - 0.1 * P + opening * 0.13 + kingWidth * 0.12);
      const w1 = r * (0.48 - 0.12 * P + kingWidth * 0.1) * (1 + 0.1 * J);
      const wm = Math.max(r * 0.12, r * (0.30 - 0.16 * P + kingWidth * 0.10) * (1 + 0.25 * J + 0.3 * J * O));
      const mx = hx + offX * 0.56;
      const my = hy + offY * 0.56;
      // A smooth waist between two flared attachments, not straight cone sides.
      const sideUp = (sign: number, inset = 1) => {
        const q = sign * inset;
        ctx.bezierCurveTo(hx + offX * 0.18 + nx * w0 * q * 0.44, hy + offY * 0.18 + ny * w0 * q * 0.44,
          mx - offX * 0.17 + nx * wm * q, my - offY * 0.17 + ny * wm * q, mx + nx * wm * q, my + ny * wm * q);
        ctx.bezierCurveTo(mx + offX * 0.18 + nx * wm * q, my + offY * 0.18 + ny * wm * q,
          bx - offX * 0.1 + nx * w1 * q, by - offY * 0.1 + ny * w1 * q, bx + nx * w1 * q, by + ny * w1 * q);
      };
      const neck = () => {
        ctx.beginPath();
        ctx.moveTo(hx + nx * w0, hy + ny * w0);
        sideUp(1);
        ctx.arc(bx, by, w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
        ctx.bezierCurveTo(bx - offX * 0.1 - nx * w1, by - offY * 0.1 - ny * w1,
          mx + offX * 0.18 - nx * wm, my + offY * 0.18 - ny * wm, mx - nx * wm, my - ny * wm);
        ctx.bezierCurveTo(mx - offX * 0.17 - nx * wm, my - offY * 0.17 - ny * wm,
          hx + offX * 0.18 - nx * w0 * 0.44, hy + offY * 0.18 - ny * w0 * 0.44, hx - nx * w0, hy - ny * w0);
        ctx.quadraticCurveTo(hx - ux * r * 0.22, hy - uy * r * 0.22, hx + nx * w0, hy + ny * w0);
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(1.5 * s + P * 2.5, 2 * s + P * 4);
      neck();
      ctx.fillStyle = gel.col(0.055 + P * 0.025, 0.25);
      ctx.fill();
      ctx.restore();
      neck();
      const body = ctx.createLinearGradient(hx - ux * r * 0.2, hy - uy * r * 0.2, bx, by);
      body.addColorStop(0, gel.col(0.38, -0.12));
      body.addColorStop(0.2, gel.col(0.86, -0.12));
      body.addColorStop(0.55, gel.col(0.9 - P * 0.06, -0.12));
      body.addColorStop(1, gel.col(0.82, -0.08));
      ctx.fillStyle = body;
      ctx.fill();
      // Screen-fixed key light, including when pulling left/down. The gel
      // turns with the gesture; the studio light does not.
      const lit = -nx * 0.6 - ny * 0.8 >= 0 ? 1 : -1;
      const lg = ctx.createLinearGradient(mx + nx * w0 * lit, my + ny * w0 * lit, mx - nx * w0 * lit, my - ny * w0 * lit);
      lg.addColorStop(0, "rgba(255,255,255,0.28)");
      lg.addColorStop(0.38, "rgba(255,255,255,0.18)");
      lg.addColorStop(0.68, gel.col(0.06, 0.15));
      lg.addColorStop(1, gel.col(0.18, 0.24));
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx + nx * w0 * 0.85, hy + ny * w0 * 0.85);
      sideUp(1, 0.9);
      ctx.strokeStyle = `rgba(255,255,255,${lit > 0 ? 0.28 + 0.1 * P : 0.06})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - nx * w0, hy - ny * w0);
      sideUp(-1);
      ctx.strokeStyle = lit < 0 ? `rgba(255,255,255,${0.28 + 0.1 * P})` : gel.col(0.12 + 0.06 * P, 0.3);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      const rootBlend = ctx.createLinearGradient(hx, hy, hx + offX * 0.3, hy + offY * 0.3);
      rootBlend.addColorStop(0, 'rgba(255,255,255,0)');
      rootBlend.addColorStop(0.45, 'rgba(255,255,255,0.5)');
      rootBlend.addColorStop(1, '#fff');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = rootBlend;
      ctx.fillRect(left, top, surface.width / pixelRatio, surface.height / pixelRatio);
      ctx.globalCompositeOperation = 'source-over';
      ctx = target;
      ctx.drawImage(surface, left, top, surface.width / pixelRatio, surface.height / pixelRatio);
    }
    // gel still clinging to the back of the bead
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r * (1 + 0.12 * P), 0, Math.PI * 2);
    ctx.clip();
    const cg = ctx.createRadialGradient(bx - ux * r * 0.9, by - uy * r * 0.9, 0, bx - ux * r * 0.9, by - uy * r * 0.9, r * 1.4);
    cg.addColorStop(0, gel.col(0.7 * (1 - P * 0.6), -0.1));
    cg.addColorStop(1, gel.col(0, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(bx - r * 2, by - r * 2, r * 4, r * 4);
    ctx.restore();
  }
}

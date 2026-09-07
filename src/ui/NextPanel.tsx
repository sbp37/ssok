import { useEffect, useRef } from "react";
import { silhouettePath, type PadType } from "../game/pads/PadTypes";

/**
 * A pad drawn as a small slab silhouette. `mode`:
 *  dark     – the NEXT tease (you don't get to see the pad)
 *  color    – the collection sheet, a discovered pad in its own gel colour
 *  partial  – something odd is coming: only a slice of the silhouette shows
 */
export function PadSilhouette({
  pad,
  size,
  mode = "dark",
  glint = true,
  shimmer = false,
}: {
  pad: PadType;
  size: number;
  mode?: "dark" | "color" | "partial";
  glint?: boolean;
  shimmer?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2 + size * 0.02);
    const R = size * 0.4;
    if (mode === "partial") {
      // a torn glimpse: only a diagonal band of the shape is visible
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.1);
      ctx.lineTo(size, -size * 0.45);
      ctx.lineTo(size, -size * 0.05);
      ctx.lineTo(-size, size * 0.3);
      ctx.closePath();
      ctx.clip();
    }
    ctx.save();
    ctx.translate(0, size * 0.04);
    ctx.scale(1, 0.94);
    silhouettePath(ctx, pad, R);
    ctx.fillStyle = "rgba(43,39,48,0.16)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.scale(1, 0.94);
    silhouettePath(ctx, pad, R);
    if (mode === "color") {
      const { r, g, b } = pad.gelColor;
      ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
      ctx.fill("evenodd");
      // a little of the real thing: pale centre, sheen
      const gr = ctx.createRadialGradient(-R * 0.2, -R * 0.3, 0, 0, 0, R);
      gr.addColorStop(0, "rgba(255,255,255,0.45)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gr;
      ctx.fill("evenodd");
      ctx.strokeStyle = `rgba(${Math.round(r * 0.75)},${Math.round(g * 0.75)},${Math.round(b * 0.75)},0.6)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(43,39,48,0.62)";
      ctx.fill("evenodd");
      ctx.strokeStyle = shimmer ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = shimmer ? 1.6 : 1;
      ctx.stroke();
    }
  }, [pad, size, mode, shimmer]);
  return (
    <span className={"sil" + (shimmer ? " shimmer" : "")} style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} />
      {glint && pad.hint && mode !== "color" && (
        <span
          className="glint"
          style={{
            background: pad.hint.color,
            boxShadow: `0 0 6px 2px ${pad.hint.color}`,
            left: size * (0.5 + (pad.hole ? 0.22 : 0.06)),
            top: size * 0.5,
          }}
        />
      )}
    </span>
  );
}

export interface NextView {
  pad: PadType;
  rare: boolean;
  rareNew: boolean;
  ultra: boolean;
  collection: boolean;
}

/**
 * The NEXT tease: a dark silhouette and "???". A passing rare variant gets a
 * shimmering rim and a line; a pad hiding something ultra shows only a torn
 * glimpse. Never the pad itself.
 */
export function NextPanel({ info, emphasis }: { info: NextView; emphasis: number }) {
  const { pad, rare, rareNew, ultra } = info;
  let line = "???";
  if (rare) line = rareNew ? "처음 보는 질감이다 ✦" : "희귀 패드가 지나가고 있어 ✦";
  else if (ultra) line = "뭔가 이상하다…";
  return (
    <div className="next" style={{ opacity: 0.55 + 0.45 * emphasis, transform: `scale(${0.94 + 0.06 * emphasis})` }}>
      <div className="next-label">NEXT</div>
      <PadSilhouette pad={pad} size={64} mode={ultra ? "partial" : "dark"} shimmer={rare} glint={!ultra} />
      <div className={"next-q" + (rare ? " rare" : "")}>{line}</div>
    </div>
  );
}

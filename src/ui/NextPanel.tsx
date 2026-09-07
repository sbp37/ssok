import { useEffect, useRef } from "react";
import { silhouettePath, type PadType } from "../game/pads/PadTypes";

/**
 * The NEXT tease. A dark translucent silhouette of the coming pad, "???", and
 * every few seconds one faint glint where its hidden object would be. It never
 * shows the pad itself – the point is to be curious, not informed.
 */
export function PadSilhouette({ pad, size, glint = true }: { pad: PadType; size: number; glint?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2 + size * 0.02);
    const R = size * 0.4;
    // soft shadow under the shape so it reads as a slab, still just a silhouette
    ctx.save();
    ctx.translate(0, size * 0.04);
    ctx.scale(1, 0.94);
    silhouettePath(ctx, pad, R);
    ctx.fillStyle = "rgba(43,39,48,0.16)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.scale(1, 0.94);
    silhouettePath(ctx, pad, R);
    ctx.fillStyle = "rgba(43,39,48,0.62)";
    ctx.fill("evenodd");
    // barest rim light
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [pad, size]);
  return (
    <span className="sil" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} />
      {glint && pad.hint && (
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

export function NextPanel({
  pad,
  emphasis,
  gated,
}: {
  pad: PadType;
  /** 0 = faint tease at ~70%, 1 = sharpened after the pad is emptied */
  emphasis: number;
  gated: boolean;
}) {
  return (
    <div className="next" style={{ opacity: 0.55 + 0.45 * emphasis, transform: `scale(${0.94 + 0.06 * emphasis})` }}>
      <div className="next-label">NEXT</div>
      <PadSilhouette pad={pad} size={64} />
      <div className="next-q">{gated ? (pad.tier === "super" ? "희귀 패드가 지나가고 있어 ✦✦" : "희귀 패드가 지나가고 있어 ✦") : "???"}</div>
    </div>
  );
}

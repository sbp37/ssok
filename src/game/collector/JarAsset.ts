// Empty RGBA glass only. Live beads are never baked into this sprite.
// 400x424 WebP, already cropped to the vessel (the jar is drawn at ≤136 css px).
const crop = { x: 0, y: 0, w: 400, h: 424 };
let image: HTMLImageElement | undefined;
let pending: Promise<void> | undefined;
let cached: { key: string; back: HTMLCanvasElement; front: HTMLCanvasElement } | undefined;

export function preloadJar(): Promise<void> {
  return pending ??= new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try { await img.decode(); image = img; cached = undefined; } catch { /* original cup fallback */ }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = `${import.meta.env.BASE_URL}assets/collector/glass-empty.webp`;
  });
}

/** Layers are rasterized only on load/resize, never per frame. */
export function jarLayers(w: number, h: number, dpr: number) {
  if (!image) return undefined;
  const key = `${w}|${h}|${dpr}`;
  if (cached?.key === key) return cached;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    return c;
  };
  const back = make(), front = make();
  // Preserve the source aspect. The glass may extend <2px vertically beyond
  // the old cup to align its inner bottom with the unchanged collision floor.
  const dh = w * crop.h / crop.w;
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.drawImage(image!, crop.x, crop.y, crop.w, crop.h, 0, h - dh, w, dh);
  };
  const bg = back.getContext('2d')!;
  bg.scale(dpr, dpr); bg.globalAlpha = 0.78; draw(bg);
  const fg = front.getContext('2d')!;
  fg.scale(dpr, dpr);
  // Thin front reflections, not an opaque white sheet over the collection.
  draw(fg);
  fg.globalCompositeOperation = 'destination-in';
  const edge = fg.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.8)');
  edge.addColorStop(0.09, 'rgba(0,0,0,0.55)');
  edge.addColorStop(0.24, 'rgba(0,0,0,0.08)');
  edge.addColorStop(0.70, 'rgba(0,0,0,0.04)');
  edge.addColorStop(0.90, 'rgba(0,0,0,0.4)');
  edge.addColorStop(1, 'rgba(0,0,0,0.8)');
  fg.fillStyle = edge; fg.fillRect(0, 0, w, h);
  // Bottom glass is in front of the floor; mouth stays visibly OPEN.
  fg.globalCompositeOperation = 'source-over';
  fg.save(); fg.beginPath(); fg.rect(0, h - 6, w, 6); fg.clip(); draw(fg); fg.restore();
  cached = { key, back, front };
  return cached;
}

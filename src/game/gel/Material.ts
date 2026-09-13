/** A development-only A/B switch. Production always uses the revised material;
 * the switch never affects generation, storage, input or physics. */
export const originalMaterial = import.meta.env.DEV &&
  new URLSearchParams(location.search).get('material') === 'original';

/** Studio study informs these colors, not a baked image of unrelated holes. */
export function siliconeColor(color: {r:number;g:number;b:number}, padId: string) {
  if (originalMaterial) return { ...color };
  // The body is composited translucently over an off-white stage; close RGB
  // channels therefore converged toward grey. Feed that same renderer a clean,
  // high-lightness/chroma base instead of changing its trusted shading model.
  const vivid = (c: {r:number;g:number;b:number}) => {
    const hi=Math.max(c.r,c.g,c.b),lo=Math.min(c.r,c.g,c.b),mid=(hi+lo)/2;
    const channel=(v:number)=>Math.max(0,Math.min(255,Math.round(mid+(v-mid)*1.18+4)));
    return {r:channel(c.r),g:channel(c.g),b:channel(c.b)};
  };
  if (padId.includes(':')) return vivid(color);
  const palette: Record<string,[number,number,number]> = {
    cloud:[255,171,207], flower:[232,181,255], donut:[255,197,158],
    paw:[180,240,210], ribbon:[174,211,255], shell:[255,226,166],
    cherry:[255,157,180], star:[179,200,255],
    heart:[255,174,184], cat:[211,214,242], bear:[244,197,145],
  };
  const c=palette[padId];return c?{r:c[0],g:c[1],b:c[2]}:{...color};
}

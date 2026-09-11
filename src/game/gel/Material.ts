/** A development-only A/B switch. Production always uses the revised material;
 * the switch never affects generation, storage, input or physics. */
export const originalMaterial = import.meta.env.DEV &&
  new URLSearchParams(location.search).get('material') === 'original';

/** Studio study informs these colors, not a baked image of unrelated holes. */
export function siliconeColor(color: {r:number;g:number;b:number}, padId: string) {
  if (originalMaterial || padId.includes(':')) return { ...color };
  const palette: Record<string,[number,number,number]> = {
    cloud:[248,177,204], flower:[230,190,250], donut:[255,205,177],
    paw:[196,232,214], ribbon:[190,214,250], shell:[250,232,190],
    cherry:[252,166,183], star:[195,208,254],
    heart:[255,168,178], cat:[222,220,234], bear:[236,206,170],
  };
  const c=palette[padId];return c?{r:c[0],g:c[1],b:c[2]}:{...color};
}

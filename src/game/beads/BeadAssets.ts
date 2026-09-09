import type { BeadType } from './BeadTypes';
import { originalMaterial } from '../gel/Material';

const assetIds: Record<string,string> = {
  heart:'heart', flower:'flower', cherry:'cherry', rainbow:'rainbow',
  bigpearl:'pearl', minicherry:'cherry', key:'key', eye:'eye',
  candystar:'star', crown:'crown', holostar:'holostar',
};
const images=new Map<string,HTMLImageElement>();
let pending:Promise<void>|undefined;
export function preloadBeadAssets():Promise<void> {
  if(originalMaterial)return Promise.resolve();
  return pending??=Promise.all([...new Set(Object.values(assetIds))].map(name=>new Promise<void>(resolve=>{
    const img=new Image();img.decoding='async';
    img.onload=async()=>{try{await img.decode();images.set(name,img);}catch{/* procedural fallback */}resolve();};
    img.onerror=()=>resolve();
    img.src=`${import.meta.env.BASE_URL}assets/beads/${name}.png`;
  }))).then(()=>undefined);
}
export function beadAsset(type:BeadType){return originalMaterial?undefined:images.get(assetIds[type.id]);}

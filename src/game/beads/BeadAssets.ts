import type { BeadType } from "./BeadTypes";
import { originalMaterial } from "../gel/Material";

/** bead type id → photo asset name (types not listed stay procedural) */
const assetIds: Record<string, string> = {
  // painted charms – shown as drawn
  heart: "heart",
  flower: "flower",
  cherry: "cherry",
  minicherry: "cherry",
  rainbow: "rainbow",
  key: "key",
  eye: "eye",
  crown: "crown",
  holostar: "holostar",
  duck: "duck",
  bigduck: "duck",
  // plain beads – the photo is recoloured to each bead's own colour (see TINTED)
  tiny: "pink",
  bigmatte: "violet",
  marble: "faceted",
  gold: "faceted",
  bigglass: "faceted",
  pearl: "pearl",
  opal: "pearl",
  bigpearl: "pearl",
  bigopal: "pearl",
  star: "star",
  candystar: "star",
  long: "long",
  gem: "faceted",
  king: "violet",
};

/** photos that get recoloured to the bead's colour (keeps their shading and sparkle, swaps the hue) */
const TINTED = new Set(["pink", "violet", "faceted", "pearl", "star", "long"]);
const studioAssets: Record<string, string> = {
  tiny: "studio-glass", marble: "studio-glass", bigglass: "studio-glass",
  pearl: "studio-pearl", bigpearl: "studio-pearl", heart: "studio-heart",
  gold: "studio-gold",
};
// The new cutouts are material assets, not a pad skin. Use them everywhere
// their existing bead ID appears, with the previous photograph as fallback.
function assetName(type: BeadType) {
  const studio = studioAssets[type.id];
  return studio && images.has(studio) ? studio : assetIds[type.id];
}

export function beadAssetTinted(type: BeadType) {
  const name = assetName(type);
  return TINTED.has(name) || name === "studio-glass";
}

const images = new Map<string, HTMLImageElement>();
let pending: Promise<void> | undefined;

/** Loads every photo bead once (WebP, ~10KB each). Resolves even when a file fails – that bead stays procedural. */
export function preloadBeadAssets(): Promise<void> {
  if (originalMaterial) return Promise.resolve();
  pending ??= Promise.all(
    [...new Set([...Object.values(assetIds), ...Object.values(studioAssets)])].map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = async () => {
            try {
              await img.decode();
              images.set(name, img);
            } catch {
              /* procedural fallback */
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `${import.meta.env.BASE_URL}assets/beads/${name}.webp`;
        }),
    ),
  ).then(() => undefined);
  return pending;
}

export function beadAsset(type: BeadType) {
  return originalMaterial ? undefined : images.get(assetName(type));
}

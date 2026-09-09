import type { BeadType } from "./BeadTypes";
import { originalMaterial } from "../gel/Material";

/** bead type id → photo asset name (types not listed stay procedural) */
const assetIds: Record<string, string> = {
  heart: "heart",
  flower: "flower",
  cherry: "cherry",
  rainbow: "rainbow",
  bigpearl: "pearl",
  minicherry: "cherry",
  key: "key",
  eye: "eye",
  candystar: "star",
  crown: "crown",
  holostar: "holostar",
};

const images = new Map<string, HTMLImageElement>();
let pending: Promise<void> | undefined;

/** Loads every photo bead once (WebP, ~10KB each). Resolves even when a file fails – that bead stays procedural. */
export function preloadBeadAssets(): Promise<void> {
  if (originalMaterial) return Promise.resolve();
  pending ??= Promise.all(
    [...new Set(Object.values(assetIds))].map(
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
  return originalMaterial ? undefined : images.get(assetIds[type.id]);
}

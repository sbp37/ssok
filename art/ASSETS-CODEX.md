# Supplied artwork integration

All four supplied files are RGB JPEGs without alpha. Black was real background,
not transparency. No image generation or recolouring was used.

- Photo 1 (1280×960): silicone thickness / light reference only. No pictured holes are rendered.
- Photo 2 (1280×1280): 15 separately bounded, connected-component cutouts. Black matte was removed, including gaps in metal loops and cherry stems; duck eyes retained. Original-resolution transparent PNGs are in `beads/original/`; aspect-preserving runtime PNGs fit within 128×128. `beads/manifest.json` records source crop, both sizes, pivot and path.
- Photo 3 (960×1280): glass edge / reflection reference only. No baked beads or lid are rendered.
- Photo 4 (1280×1280): isolated golden glint preserved in `fx/sparkle.png` for reference. This integration keeps Claude's original treasure effects; this bitmap is not loaded at runtime.

## Runtime mapping

| Cutout | Existing IDs / compatible colours |
|---|---|
| pearl | bigpearl |
| star | candystar |
| heart | heart |
| flower | flower |
| cherry | cherry, minicherry |
| rainbow | rainbow |
| key | key |
| eye | eye |
| crown | crown |
| holostar | holostar |

Ordinary beads (including round glass, pearl and star) keep Claude's original
procedural renderer. Only the special/hidden IDs above receive sprites.
`duck`, `faceted`, `pink`, `violet`, and `long` remain extracted references:
the opaque duck differs from the game's clear material and there is no faceted ID.
Unmatched IDs retain their original renderer. No IDs, colour data, rarity weights,
sizes or physics changed. The supplied blue eye changes only the matching charm's
appearance, not its stored type.

Runtime images retain their original aspect, fit inside the existing diameter
(the oval's existing major axis), and use centred pivots. Transparent padding is
included in that fit, so pictures cannot outgrow the existing hit bounds. Cutout
texture highlights are not painted over a second time.

Images preload once, decode before use, and populate the existing sprite cache.
The gel base is invalidated once after preload settles. Failure leaves procedural
sprites available. URLs use Vite's BASE_URL, including GitHub Pages `/ssok/`.
Original-resolution PNGs are not requested by the game.

Extraction provenance: original task checkout `scripts/extract-assets.py`.
Images here are preserved from that checked extraction; no new image generation
or background recolouring was performed in this integration.

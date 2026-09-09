# Empty glass collector

`glass-empty.png` is a new built-in imagegen RGBA asset (1195 × 1316).
Original alpha and RGB are preserved. No beads, lid or liquid are baked in.
Vessel crop: x=37, y=75, width=1116, height=1182; centred pivot (0.5, 0.5).
Runtime width follows the existing collector (112–136 CSS px). Aspect is retained.
`JarAsset.ts` caches DPR-sized rear and thin front reflection layers once after
image decode and on resize. Draw order: rear glass → actual simulated beads →
front edge/bottom reflections. Collision bounds, entrance and floor are unchanged.
Load/decode failure retains the original procedural cup. Vite BASE_URL is used.

Generation mode: built-in image_gen, not CLI/API, no local Blender installation.
Final prompt:

> Use case: product-mockup. Asset type: transparent PNG sprite for an existing mobile bead-collection game, not a mockup. Generate ONE EMPTY clear glass collecting vessel, elegant photorealistic studio 3D material, subtle blush-pink edge tint, thick rounded glass bottom, broad softbox reflection at upper left and a slim refractive right edge. Shape constraints are critical: upright wide-mouth OPEN glass tumbler/jar with NO lid, NO neck, nearly vertical sides widening slightly toward the bottom, rounded lower corners. Overall vessel aspect width:height = 0.90, shown straight-on with only a slight top-down view so the open oval mouth is visible. Large uninterrupted clear center. It must look like dimensional glass, not a thin line icon, not a plastic container. Background must be genuine alpha transparency, including transparent clear interior (very low opacity in center); no baked white, black or checkerboard background. Entire vessel visible and centered with 5% empty transparent padding. Light blush refractions in the thick edge and bottom, naturally curved highlights. No contents, NO beads, no liquid, no lid, no handles, no label, no ornament, no sparkles, no lettering, no ground plane or cast shadow. Intended to layer behind live physical beads and add thin front reflections over them at runtime; preserve the visibly open entrance. Output one production-ready RGBA PNG asset.

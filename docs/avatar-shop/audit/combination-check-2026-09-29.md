# Character × accessory visual check — 29 September 2026

## Coverage

Browser comparison uses the actual shop Figure component with isolated preview state. No inventory purchases or saved avatar changes. All 10 presets × 34 catalogue entries were inspected (340 pairings), including starter items and stickers. Each character was captured at top and bottom of the comparison grid. One mixed outfit was additionally inspected on all 10 characters: Club Cap, Orange Rally shirt, Sand Court shorts, Court Sprint shoes, Blue Focus wristband and Golden Ace racket (10 mixed checks).

The grid is a normal-scale visual screening, not pixel-level certification. It does not enumerate every multi-slot permutation, and generated-photo avatars are outside this preset matrix. Browser screenshots were inspected inline during the session; no claim of a persisted screenshot archive.

## Findings and changes

- Club Cap / Champion Cap sat high and left of the forehead: adjusted placement to translate(35 55), scale(.94), with matching tighter crown hair visibility.
- Shirt hems could show the original white shirt underneath: extended non-starter shirt artwork vertically by 4% around the shoulder origin, retaining slot clipping.
- Rocco's original shirt collar entered the head layer: preset-specific head boundary now ends above that collar; photo avatars retain the deeper jaw boundary.
- Sticker size was fixed in pixels and overwhelmed small previews: size and offsets now scale with the rendered figure.
- No missing item graphics or duplicated faces were observed across the 340 pairings.

## Remaining visual issues

Dara and Rocco still show small original shoulder-edge seams in some coloured tops. Flattened source illustrations differ slightly in body silhouette. A broad erase mask was tried and rejected because it cut into the forearm; it was removed. Do not classify these combinations as visually perfect. They need narrowly fitted, per-character shoulder cutouts or aligned source clothing artwork.

The cap is improved but the material/style difference of the backwards-cap texture remains an art limitation. The matrix must not be presented as a blanket pass for every possible outfit.

## Repeatable preview

Development only: `/es/avatar-fit-check`. Buttons switch the independent preview character; Mixed outfits shows the ten combined outfits. It cannot buy or equip anything. The route returns 404 outside development.

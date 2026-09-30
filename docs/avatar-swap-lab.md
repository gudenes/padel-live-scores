# Avatar swap fitting test

Local preview: `/es/avatar-lab` (development only), linked from the profile.
Six independently toggled slots use one registered alternate artwork and SVG clip
regions over the existing face-06 master. No purchases, account writes, or changes
to the user's saved outfit. This proves swapping on one fixed pose; it is not yet
a general wardrobe asset pipeline. Other characters and generated faces need
separate fit checks and proper transparent layers before store integration.

Artwork: `public/play/avatars/swap-lab/alternate.png`.
Generated with the built-in image-generation tool using face-06.png as edit target.
Prompt: preserve the exact 1024×1536 canvas, character identity, pose, limbs and
background; change racket frame to lime, shoes to lime/charcoal, shorts to teal,
T-shirt to orange with cream lightning, wristband to lime, and add a charcoal/lime
cap. Preserve placement and silhouettes for independent registered region swaps.

Controls: tap a slot to equip/remove its item immediately; try all six; reset;
compare original. Preview state resets when leaving/reloading the page.

## Three-character fitting pass

The selector now offers Nacho (face-06), Rayo (face-02), and Dash (face-08).
Equipped slot selections carry across characters. Each character loads its own
registered alternate; artwork is preloaded before enabling controls. The original
face/body remains the source for unequipped regions.

Additional built-in generation prompts use each character's original as the edit
target, preserving its face, skin, pose, geometry and background while applying
the same six changes described above. Files: `face-02.png` and `face-08.png` in
`public/play/avatars/swap-lab/`. These are per-character fitting variants, not proof
that a single clothing asset fits arbitrary bodies or photo-generated avatars.

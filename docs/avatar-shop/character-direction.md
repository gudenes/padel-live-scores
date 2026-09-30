# Character and headwear review — 29 September 2026

## Current implementation

The shop layers clipped regions of full-character illustrations. `gearArtwork` has dedicated outfit artwork for faces 02, 06 and 08; other faces fall back to face 06 for non-starter clothing. The backwards cap suppresses hair with one horizontal mask at y=185. Headwear uses a fixed placement; photo avatars receive an additional scale/translation for the original cap collections. Photo generation still returns one complete character on an opaque background.

Consequences: there is no independent hair layer, no compressed hair under a cap, and no true rear brim layer. Clothing cutouts can include another character's skin. Matching coordinates alone cannot reconcile independently generated anatomy and lighting. The recent tight hat masks address face overlap but do not solve this artwork structure.

## Proposed asset structure

Keep the 1024 × 1536 wardrobe canvas and a fixed camera, pose, head angle, neck join, and light direction. Prepare real transparent layers, with no baked dark background:

1. Rear hair and rear brim.
2. Body and clothing with consistent joint positions; preserve each character's skin.
3. Face, ears and neck, independent of hair and hats.
4. Hair variant: normal, fitted under a cap, or open-top for visors/bandanas.
5. Hat crown/front rim and selected front hair details.

Each accessory manifest should specify front/rear asset paths, attachment position, compatible hair variants and any per-head adjustment. Product thumbnails remain separate from worn artwork. A ponytail or bun needs an explicit route behind the hat or through its opening.

First proof: Brisa, her normal ponytail and a fitted-under-cap version, plus Reverse Rally. Validate bare head, cap on/off, side hair, forehead, face preservation, profile portrait and shop view. Then expand to all ten. Do not replace the current generated-photo pipeline with a request for a sprite sheet alone: generation needs a preparation/validation step before individual layers can be trusted. Existing saved avatars need a fallback and a deliberate upgrade path.

No additional backend provider is needed. Layered artwork is the missing prerequisite; a 2D animation tool can be evaluated separately when motion is required.

## Original roster

These are creative references supplied by the user, not a historical ranking or claims of affiliation. Retain stable face IDs and purchases. Names are shared across languages. Current artwork is unchanged; the visual brief is for a future artwork pass.

| Existing ID | Fictional name | User-supplied inspiration | Proposed broad character direction |
|---|---|---|---|
| face-01 | Brisa | Bea González | Energetic attacker; expressive, playful original design |
| face-02 | Nilo | Pablo Lima | Composed competitor; compact, athletic original design |
| face-03 | Dara | Delfina Brea | Thoughtful tactician; focused expression |
| face-04 | Tano | Agustín Tapia | Inventive shot-maker; playful confidence |
| face-05 | Vera | Gemma Triay | Commanding competitor; assured posture |
| face-06 | Beltrán | Fernando Belasteguín | Experienced strategist; composed expression |
| face-07 | Alexis | Alejandro Lasaigues | Classic technical player; understated retro styling |
| face-08 | Ciro | Arturo Coello | Powerful attacker; bold original silhouette |
| face-09 | Mika | Original tenth character | Adaptable newcomer; curious, upbeat personality |
| face-10 | Rocco | Roby Gattiker | Vintage competitor; distinctive original mature design |

Use broad sporting archetypes, not recognisable copies of faces, tattoos, signatures, sponsor kits or signature combinations of attributes. Different names alone do not establish clearance for commercial likeness use. These names are creative working names, not a trademark clearance result.

## Existing-artwork layer pass

Implemented SVG composition using the existing assets, without generating characters. `avatar-layers.ts` defines the head boundary, face/ear envelope and cap-specific hair visibility. Renderer draws body, rear hair, rear cap brim, wardrobe, original face and front headwear separately. Closed caps hide protruding crown hair; visors/bandanas and no-hat leave it visible. Removing headwear restores the original artwork. Starter footwear beneath the replacement shoes is masked out to remove duplicate sole edges.

Checked all ten preset heads wearing Reverse Rally in a temporary browser comparison, plus Brisa with no hat. This is a masked composition of flattened artwork, not newly authored transparent source layers; per-character collar/hair boundary refinement may still be needed. No new images, purchases or saved character changes were made.

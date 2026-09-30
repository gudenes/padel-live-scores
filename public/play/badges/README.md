# Collectible achievement stickers

Generated with the built-in image-generation tool on 2026-09-28 using `public/play/avatars/shop/king.png` as the style reference. Original lime atlas retained; the current UI uses collectible-stickers-orange-v2.png.

Prompt: Create a 4 × 4 sprite atlas of cream-outlined, black-extruded, glossy lime/gold collectible sporting sticker symbols: checkmark, crown, lightbulb, bell; magnifying glass, globe, bookmark, star; newspaper, play, megaphone, flame; diamond, lightning, trophy, crossed padel rackets. No text. Uniform charcoal background and separate icons. Color revision: preserve positions and shapes; introduce #FF6B2B orange and #F5A623 amber on most accent surfaces, retaining smaller lime accents and gold trim.

BadgeSticker.tsx contains measured bounds for each symbol to avoid cutting the sticker edges. The atlas has an opaque charcoal background; lighten blending integrates it with the dark UI. This is not a transparent source image. Tier labels preserve progression. Locked symbols are desaturated and dimmed, with text indicating locked state in the profile rail.

XP was removed from the profile display only; underlying achievement logic and XP calculation elsewhere are unchanged.

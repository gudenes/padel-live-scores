# Badge collection v2

Nine individually generated badge artworks; orange, cream, gold and lime. Built-in image-generation tool used. Integrated locally into profile and achievements. Production UI has not been deployed. Existing badge IDs and thresholds are preserved; retired earned badges remain in Legacy.

## Translation approach
Keep stable badge identifiers independent of names. Use one text-free artwork per badge and put localized names, descriptions, progress and unlock conditions in the existing next-intl message files. `labels.json` contains proposed names for en/es/pt/fr/it; the standalone preview lets reviewers switch languages. The approved active names and explanations are wired into `src/messages/{locale}.json`. Milestone messages should use ICU plural forms and parameters rather than baked-in numbers. Accessible controls should use the localized name. Artwork itself is decorative where the adjacent heading names it. Share images can render the localized label as text at export time.

## Generation prompt
Each image used the existing King of Predict sticker and approved six-badge concept as references. Shared prompt: standalone centered collectible achievement sticker; cream die-cut contour, black sculpted extrusion, glossy gold and orange #FF6B2B with small lime #7ED321 accents; no text; bold silhouette readable at 80px. Subject prompts were: checkmark embracing ball (First Pick); grand gold crown orange jewel and ball (King); blazing orange ball (On Fire); brain and bracket (Tournament Brain); magnifying glass framing three players (Scout); bookmark/court and racket (Match Tracker); orange star, racket and speech bubble (Match Critic); shield/laurels and crossed rackets (Founder); handshake and gold stars (Ambassador).

Scout and Founder were regenerated with opaque charcoal backgrounds after failed alpha exports. Preview uses lighten blending for these sources. Other alpha properties are listed in metadata.json. Preserve original PNGs for future editing. Files remain source-quality exports; the app uses Next Image for delivery.


## Match Tracker correction — 28 September 2026
Built-in image generation edited the original Match Tracker. Final prompt: “Replace the court with a clearly recognizable isometric padel court with transparent glass walls, a net across the middle and orange playing surface. Padel has no tennis doubles alleys. One service line across each half, center service line from each service line to the net; back areas empty. Court dominates, small racket outside. Keep orange/gold/cream sticker styling, black extrusion and lime accents. No text. Transparent background.”

Final asset: `match-tracker.png`. The original generated output is preserved under the Codex generated-images directory (`exec-6ee1c859-1d35-4ae7-b9e2-780c2bceb8ee.png`).

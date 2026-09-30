# Profile tabs and header avatar — 2026-09-28

final result: passed

Scope: option 1 underline navigation and synchronization of the local wardrobe portrait with the shared header. Existing card layout and artwork retained.

Reference: generated_images/01a0ddb4-d548-7453-8f2c-b3ca5bb8615d/exec-b8fb32e8-17a6-44eb-9fb2-34463cf32ce0.png under Codex home.

Visual comparison: selected reference and live profile screenshot displayed together. Compared app content within the existing phone stage; reference raster and live screenshot have different scale. Equal-width tabs, green active label/underline, cream inactive label, divider and top-right sharing match the selected direction. No P0/P1/P2 findings within scope. Orange notification dot is conditional on unread badges (none currently).

Interaction verification: switched Player → Badges → Player; correct selected state and panels, six earned badges displayed. Home header screenshot shows the same selected character and green cap as profile. Wardrobe/profile/header subscribe to the same saved local state and change event. Existing production outfit path retained; no deployment or account-wide wardrobe persistence added.

Validation: scoped ESLint passed with the existing ProfileButton set-state-in-effect rule excluded; that pre-existing warning remains. git diff --check passed. No full project typecheck claimed.

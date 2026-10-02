# Profile tabs and header avatar — 2026-09-28

final result: passed

Scope: option 1 underline navigation and synchronization of the local wardrobe portrait with the shared header. Existing card layout and artwork retained.

Reference: generated_images/01a0ddb4-d548-7453-8f2c-b3ca5bb8615d/exec-b8fb32e8-17a6-44eb-9fb2-34463cf32ce0.png under Codex home.

Visual comparison: selected reference and live profile screenshot displayed together. Compared app content within the existing phone stage; reference raster and live screenshot have different scale. Equal-width tabs, green active label/underline, cream inactive label, divider and top-right sharing match the selected direction. No P0/P1/P2 findings within scope. Orange notification dot is conditional on unread badges (none currently).

Interaction verification: switched Player → Badges → Player; correct selected state and panels, six earned badges displayed. Home header screenshot shows the same selected character and green cap as profile. Wardrobe/profile/header subscribe to the same saved local state and change event. Existing production outfit path retained; no deployment or account-wide wardrobe persistence added.

Validation: scoped ESLint passed with the existing ProfileButton set-state-in-effect rule excluded; that pre-existing warning remains. git diff --check passed. No full project typecheck claimed.

## My plays compact cards — 2026-10-02

final result: passed

Compared both user-provided screenshots with captures 17-compact-pending.png and 18-compact-results.png in output/market-group-review, displayed together for review. Compared the app content; reference and desktop preview use different phone-frame scales.

Pending: compact bordered cards, separate Yes/No badge, amber pending status, top-right match link, question then matchup/context, inline Guacas played and conditional return, local date. Three complete cards fit in the visible list. The extra conditional-return caption is intentional to make the amounts understandable.

Results: compact rows, explicit won/lost/refunded badges, matchup, amounts returned, net result, date groups and match links. Date grouping uses market settled_at and the user's timezone; missing dates use Earlier results. Clock times replace illustrative relative ages. Results retain the user's pick, absent in the reference, to avoid ambiguous wins on No predictions.

Preserved approved chunky filter buttons rather than the reference's rounded buttons. Existing app assets and navigation retained. No new artwork needed. Filters verified in browser. Automated tests cover filter separation, pending chronology, payout flooring, matchup visibility, and results chronology/grouping. No P0/P1/P2 issues found in the inspected states. Full accessibility audit and all locale/device combinations were not performed.

## Leaderboard personal summary — 2026-10-02
- Implemented reference direction with the approved chunky controls: summary, compact top three plus own neighborhood, highlighted self, and expandable full ranking.
- Uses actual net worth and available Guacas; weekly scope accurately describes active participants, without inventing weekly profit or movement.
- Removed simulation badges from leaderboard rows and player preview.
- Browser verified weekly/season switching, full ranking expansion and player preview; lint and diff checks passed.

## Net winnings ranking — 2026-10-02
- Removed next-rank Guacas requirement. Ranking now sums latest settled payouts minus their position costs; wardrobe spending and grants are excluded.
- Week uses settlement timestamps in trailing seven days, season uses active-season results, all covers all seasons. Only players with settled results enter the ranking; void results contribute nothing.
- Simulation standings use the same confirmed source results, cost subtraction, periods and correction handling.
- Calculation tests passed (8 executions across configured projects), TypeScript and targeted lint passed. Local UI verified real net winnings and labels.

## Personal summary and avatar consistency — 2026-10-02
- Centered the three summary statistics within equal-width columns.
- Own-player portraits/full previews now reuse the header/profile wardrobe selection; other members still load their saved server appearances.
- Profile menu now uses the selected wardrobe portrait, with account photo/initial fallback.
- Two regression checks passed for own portrait/full body and other-member separation. TypeScript and targeted lint passed.

## Weekly history navigation — 2026-10-02
- Removed All time from visible controls; history icon shares the Week/Season row.
- History expands previous/next controls plus This week; dates stay visible.
- API and simulation ranking now use Madrid Monday midnight to following Monday midnight with an exclusive end; historical weeks can cross seasons.
- DST and rollover tests passed, as did type checking and lint. Browser confirmed previous-week navigation updates the date range and reloads rankings.

## Member follows — 2026-10-02
- Added an account-owned, persisted follow relationship with unique pairs, no self-follow, RLS and service-only access.
- Added whitelist-gated read/write API, same-origin mutation checks, idempotent follow and caller-scoped unfollow.
- Player preview shows Follow/Following and real follower/following totals; leaderboard Following filter preserves global ranks and has empty/error states.
- Applied additive table migration. Three API authorization/idempotency/unfollow checks, TypeScript and targeted lint passed.

## Compact following and origin fix — 2026-10-02
- Replaced text-heavy Following filter with a people icon and count, preserving chunky face/skirt styling and accessible action names.
- Follow writes now reuse isTrustedPlayWrite, matching shop/trade behavior under Next loopback-host normalization and production origins.
- Four API tests passed including the normalized-host regression. Browser retry successfully saved Xx006 and showed Following / 1 follower.

## Play avatar loading — 2026-10-02
- Following includes the current player alongside followed members, retaining global ranks.
- Added account-keyed short-lived appearance caches with in-flight request sharing; retained last correct data on refresh failure. Own avatars no longer also fetch the public member endpoint.
- Avatar artwork waits for all unique image layers before fading in, with a fixed-size neutral placeholder and reduced-motion support. Requests time out rather than remaining pending indefinitely.
- Five regression checks passed for request reuse/account separation, refresh failures, own/other avatars and shared image readiness. TypeScript and targeted lint passed. No production latency claim; local preview suffered server/network delays during visual review.
- Final loading guard tolerates failed accessory images and bounds the wait to 8 seconds; a missing layer cannot permanently hide the character. Added failure regression coverage (six focused tests passed). Member appearance requests retry once after a transient failure and preserve cached data. Confirmed own avatar across header/summary/row and self inclusion under Following. Another member remained on the neutral placeholder during local API delays; complete remote-avatar visual verification remains outstanding. Proof: output/market-group-review/28-avatar-loading-following.png.

## Production release preparation — 2 October
- Based on current origin/main bb8552edd, preserving current web/coach/beta pages.
- Play, shop, shared avatars and follows continue to require server-side Play access. No whitelist or feature flag changes.
- Keep A01 art development-only: face-10 has five incomplete fitted headwear variants. Registered the existing finished v6 files for the other avatars. Production keeps its current artwork while receiving the UI/cache changes.
- Keep ordinary non-Play account photos on explicit access denial; transient wardrobe failures retain a neutral placeholder or cached wardrobe.
- Updated obsolete live-filter test to reflect the approved removal of that control.

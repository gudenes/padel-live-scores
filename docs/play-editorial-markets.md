# Editorial markets — September 27, 2026

## Implemented locally

Admin → Play → Markets has three editable drafts saved under
`.local/play-market-drafts/`, outside Git. Its authenticated loopback-only API
reads Rotterdam's real main draw. Saving does not write to Supabase or open a
tradable market. There is no publish operation yet.

- **Rotterdam P2:** any completed 6–0 in the main draw, settling at tournament end.
  Tournament: `f5975267-7748-4a6a-9e21-3498ec0f04a5`.
  Both categories are selected by default; this assumption is editable.
- **Daily pick:** choose a main-draw match. Requires four known players and a
  future scheduled start. No pick was made because start times are missing.
- **Partnership:** Lebrón and Augsburger still together on December 8, 2026 at
  23:59:59 Madrid. This is the requested deadline, not a claim about season end.

FIP lists Rotterdam on September 27–October 4, 2026:
https://www.padelfip.com/events/rotterdam-p2-2026/

## Remaining work before publication

Add an authenticated, origin-checked publication endpoint backed by an atomic
service-only database operation. Freeze question, scope, rules and resolver
version. Enforce season/exposure limits and idempotency. Reuse an existing
match-winner market for a daily pick. The database currently requires exactly one
match or tournament parent, so the partnership needs standalone-market support.

### Tournament resolver and forecast

The existing `match.any_set_bagel` is a single-match resolver. Add a versioned
tournament resolver with explicit main rounds, selected categories and verified
draw coverage. Prefer final `set_score` over stale live game counters.

Close trading immediately on a confirmed qualifying 6–0, including during a
match. Enforce in the atomic trade path: polling alone leaves a window for bets
on a known result. Settle after the selected draws finish. NO requires complete
coverage and final scores for all played matches. Missing data is not evidence
of NO. Exclude qualifying, walkovers and match tiebreaks. Completed sets before
retirement count. Postponements delay settlement; cancellation or ambiguity goes
to review using the published refund rule. Record evidence for corrections.

Calibrate per-match bagel probabilities by category/tier/pair strength. With no
bagel yet, a transparent approximation is `1 − product(1 − p_i)` across remaining
matches; this assumes independence. Include future rounds using calibrated
priors. Absent fixtures must not mean zero remaining matches. Persist model
version, sample, coverage and update time. A live match needs a conditional model
or an explicitly retained pre-match prior. A confirmed bagel means forecast 1 and
closed trading. Never reset LMSR q values, shares, balances or opening seed when
updating the forecast. The executable price still comes from the market book.

Do not apply the existing 20.3% mixed-match bagel rate blindly to a whole event.
An “any bagel” market may be nearly certain; review its calibrated estimate first.
A bagel-count threshold could be a later alternative.

### Daily selection

Suggest matches using competitiveness, player ranking and round, with admin
choice and one pick per local day. Refresh schedule on publication; lock before
play. Resolve through the existing match-winner settlement flow.

### Partnership review

Use a manual resolver with dated official evidence and source URLs. Rumours,
missing registrations, injuries and temporary substitutes alone do not prove a
split. An announcement effective after the deadline does not count. Require
positive evidence for YES too, not just absence of breakup news. Ambiguous cases
remain under review. The opening probability requires an explicitly labelled
editorial estimate or defensible model; no probability has been invented.

## Validation

Five unit tests cover defaults, daily eligibility, invalid probabilities, draft
identity validation and publication blockers. Changed admin files pass ESLint.
Browser verified the editor, real player options and local draft saving.
No deployment or shared database writes were performed.

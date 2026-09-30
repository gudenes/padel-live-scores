# Market admin alignment — 29 September 2026

## Implementation update

The database-backed authoring flow now replaces the development-only draft panel. The scope and atomic publishing migrations have been applied, and the seven selected drafts are saved. Concurrent caps, per-tournament counts through match bindings, semantic deduplication, frozen copy, early locking and settlement evidence are implemented and tested. Deployment and live input requirements are tracked in `play-selected-beta-implementation.md`. The sections below record the original design review.

## Existing system to retain

- **Play → Templates** lists DB templates, their gates, pricing source and exposure settings. Operators can enable/disable templates and preview the generator.
- **Preview** forwards to the real worker in dry-run mode. Keep this single source of truth; do not duplicate pricing or eligibility in the admin.
- **Generator** discovers upcoming Premier matches, checks gates, applies limits, and creates instances. Today it only generates `pre-match` templates.
- **Play → Markets** lists instances and offers settlement/correction controls.
- **Editorial drafts** are a separate development-only prototype: three hard-coded IDs, Rotterdam-only match selection, local JSON storage, and no publish operation. This is useful preparation UI, not the production authoring system.

## Match-day change

The live `match.winner` template had QF/SF/F gates. Expand that template to R128/R64/R32/R16/QF/SF/F, retaining its top-50 and 15–85% competitiveness requirements. Disable the legacy `match.winner.test_r16` template to prevent parallel winner markets. Preserve all existing positions and markets. The daily-pick draft selector already includes every main-draw round.

Main draw means eligibility, not a promise to publish every match: missing prices, missing schedules, incomplete pairs and global caps can still exclude candidates. Qualifying is excluded. Other disabled templates remain disabled.

## Scalable extension for the selected seven markets

Use reusable template families, not seven bespoke creation endpoints:

1. Pair reaches a round (parameter: round).
2. Tournament champion / other champion (parameter: pair and outcome direction).
3. Pair title count across a fixed list of events (parameters: count, event IDs, minimum participation).
4. Player ranking threshold in a date window (parameters: player, threshold, window).

The seven selected entries become configurations of those families. The resolver functions added in the previous turn are reusable building blocks; the static shortlist is a bootstrap input, not a second permanent market catalog.

### One operator workflow

**Choose template → bind tournament/player/pair and dates → preview evidence, price and rules → save draft → publish.**

- Store drafts in the database with revision, creator, timestamps and lifecycle (`draft`, `ready`, `published`, `archived`), replacing local JSON files.
- Validate parameters with a shared schema per resolver family. Reject unknown fields and mismatched scope.
- Extend the existing worker with candidate providers for match, tournament, event-list and ranking scopes. Preview and publish must invoke identical validation/pricing.
- Freeze question translations, settlement rules, resolver version, scope, prices and their sources on each instance. User-facing questions currently read the template join; template edits must not rewrite the meaning of open positions.
- Publish through one transactional operation that checks capacity and deduplicates a stable semantic identity (season + question family + subject + scope), including across template versions.
- Maintain whitelist enforcement through existing Play API access checks. Use operator authentication and same-origin checks on admin mutations.
- Preserve the current market list and settlement controls. Surface incomplete evidence, disputes and corrections there, not in a separate ad-hoc admin.

## Issues to resolve before scaling volume

- Caps are currently calculated before insertion in application code. Concurrent generators can each see spare capacity. Enforce limits and publish atomically in Postgres.
- Existing match rows have `tournament_id = null` because of the one-scope constraint. The generator's per-tournament daily count currently reads that nullable column; count via the match's tournament instead, or freeze a separate owning-tournament field.
- Existing uniqueness is per template; two winner templates can create equivalent markets for the same match. Retiring the R16 test template addresses the current instance, but semantic deduplication is needed generally.
- Admin template counts and generator reads need bounded pagination/aggregation as history grows; do not rely on an implicit API row cap.
- Existing template mutation supports only enable/disable. Add validated authoring and audit history rather than exposing raw resolver JSON editing.
- Verify actual-start locking, evidence persistence and payout retries end to end for the new scopes before activation.

The previous editorial-scope SQL is a prepared migration, not a deployed schema. Integrate it with this unified publish design and test it against Postgres before applying it. No second publishing system should be built around the local drafts.

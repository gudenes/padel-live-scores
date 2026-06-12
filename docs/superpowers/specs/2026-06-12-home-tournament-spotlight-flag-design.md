# Home Tournament Spotlight — Admin Feature Flag

**Date:** 2026-06-12
**Status:** Approved

## Problem

The home page renders a "TORNEO DESTACADO" tournament spotlight hero
(`TournamentSpotlightHero`) above the rankings section. Now that the live
tournaments carousel is working well, the spotlight is redundant. We want to
hide it — but reversibly, via an admin toggle, without a deploy each time.

## Goal

Add an admin-toggleable feature flag that shows/hides the tournament spotlight
hero on the home page. Defaults to **OFF** (hidden) in both production and local.

## Non-goals

- No removal of the `TournamentSpotlightHero` component or its data fetching.
- No new feature-flag infrastructure — reuse the existing `feature_flags` table,
  `src/lib/feature-flags.ts`, and the ops `FeatureFlagsTab`.
- No changes to the tournament carousel.

## Approach

Mirror the existing `HOME_LIVE_TOURNAMENTS_CAROUSEL` flag exactly. That flag
already gates the carousel at the top of the same home page and reads from the
`feature_flags` table inside `fetchData()`. We add a sibling flag the same way.

### 1. Migration

New migration `supabase/migrations/<date>_feature_flag_tournament_spotlight.sql`
inserts one seed row into `feature_flags`:

| column          | value                                                       |
|-----------------|-------------------------------------------------------------|
| `key`           | `home_tournament_spotlight`                                 |
| `enabled`       | `false`                                                     |
| `enabled_local` | `false`                                                     |
| `label`         | `Home: Tournament Spotlight`                                |
| `description`   | `Show the featured-tournament spotlight hero on the home page.` |

Idempotent `INSERT ... ON CONFLICT (key) DO NOTHING`, matching the existing
flag-seed migration style.

Apply via the pg driver + `DATABASE_URL` (per repo convention), not
`supabase db push`.

### 2. Flag key constant

`src/lib/feature-flags.ts` — add to `FLAG_KEYS`:

```ts
HOME_TOURNAMENT_SPOTLIGHT: 'home_tournament_spotlight',
```

### 3. Home page wiring — `src/app/[locale]/(app)/home/page.tsx`

The home page is a client component. Inside `fetchData()` it already queries the
`feature_flags` table for the carousel key. Change that query to fetch **both**
keys in one round-trip (`.in('key', [...])`), then resolve each row via
`resolveFlag()` into its own piece of state:

- Keep existing `carouselEnabled`.
- Add `spotlightEnabled` (default `false`).

Gate the render (currently ~line 653) so the heading disappears with the hero:

```tsx
{spotlightEnabled && spotlightTournament && (
  <>
    <SectionTitle>{t('featuredTournament')}</SectionTitle>
    <TournamentSpotlightHero ... />
  </>
)}
```

(The exact JSX shape matches whatever currently wraps the `SectionTitle` +
`TournamentSpotlightHero` pair — both must be inside the gate.)

### 4. Admin UI — no code changes

`FeatureFlagsTab` enumerates every row in `feature_flags` and renders Production
+ Local toggles per flag. Once the migration runs, the new flag appears
automatically in the ops dashboard's Feature Flags tab. Operators flip the
Production toggle ON to restore the spotlight — no deploy.

## Behavior

- After deploy + migration: spotlight hero and its "TORNEO DESTACADO" heading are
  gone from the home page (flag OFF).
- Operator toggles Production ON in ops → spotlight returns on next home-page load.
- `enabled_local` lets us preview the spotlight on localhost independently of prod.

## Testing

Verify locally in the running app:

1. Flag OFF (default) → spotlight hero **and** heading are absent from home.
2. Set `enabled_local = true` → spotlight + heading render again.
3. The new flag appears in the ops Feature Flags tab with working Production +
   Local toggles.

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/<date>_feature_flag_tournament_spotlight.sql` | new — seed flag row |
| `src/lib/feature-flags.ts` | add `HOME_TOURNAMENT_SPOTLIGHT` key |
| `src/app/[locale]/(app)/home/page.tsx` | fetch + resolve flag, gate spotlight render |

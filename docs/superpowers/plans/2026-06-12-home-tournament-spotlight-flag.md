# Home Tournament Spotlight Feature Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DB-backed admin feature flag (`home_tournament_spotlight`, default OFF) that shows/hides the "Tournament Spotlight" hero on the home page.

**Architecture:** Mirror the existing `HOME_LIVE_TOURNAMENTS_CAROUSEL` flag. Seed a row in `feature_flags`, add the key to `FLAG_KEYS`, and in the home page's `fetchData()` merge the spotlight key into the carousel's existing `feature_flags` query (one `.in()` round-trip) and resolve both via `resolveFlag()`. Gate the spotlight render (heading + hero) on the resolved value. The ops `FeatureFlagsTab` auto-lists the new row — no admin code changes.

**Tech Stack:** Next.js 16 (client component), Supabase JS, existing `src/lib/feature-flags.ts` helpers, SQL migration.

**Spec:** [docs/superpowers/specs/2026-06-12-home-tournament-spotlight-flag-design.md](../specs/2026-06-12-home-tournament-spotlight-flag-design.md)

---

### Task 1: Seed migration for the flag row

**Files:**
- Create: `supabase/migrations/20260612120000_home_tournament_spotlight_flag.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260612120000_home_tournament_spotlight_flag.sql
-- DB-backed feature flag to show/hide the "Tournament Spotlight" hero on the
-- home page, toggleable from the ops Feature Flags tab (no Vercel redeploy).
-- Now that the Live Tournaments carousel covers featured events, the spotlight
-- is redundant — ship it OFF in both prod and local; flip `enabled` from admin
-- to bring it back.
insert into public.feature_flags (key, label, enabled, enabled_local, description)
values (
  'home_tournament_spotlight',
  'Home · Tournament Spotlight hero',
  false,
  false,
  'Shows the featured-tournament spotlight hero (and its heading) on the home page, above Rankings. OFF — the Live Tournaments carousel now covers featured events.'
)
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply the migration**

Apply via the pg driver + `DATABASE_URL` (repo convention — NOT `supabase db push`, migrations have drift). Use the same method the repo already uses for applying migrations (see `scripts/` or run the migration SQL through a `pg`/`psql` connection string from `DATABASE_URL`).

Run (psql form):
```bash
psql "$DATABASE_URL" -f supabase/migrations/20260612120000_home_tournament_spotlight_flag.sql
```
Expected: `INSERT 0 1` (or `INSERT 0 0` if the row already exists — both fine, idempotent).

- [ ] **Step 3: Verify the row exists**

Run:
```bash
psql "$DATABASE_URL" -c "select key, enabled, enabled_local from public.feature_flags where key = 'home_tournament_spotlight';"
```
Expected: one row, `enabled = f`, `enabled_local = f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260612120000_home_tournament_spotlight_flag.sql
git commit -m "feat(home): seed home_tournament_spotlight feature flag (OFF)"
```

---

### Task 2: Register the flag key

**Files:**
- Modify: `src/lib/feature-flags.ts:19-28` (the `FLAG_KEYS` object)

- [ ] **Step 1: Add the key**

In `src/lib/feature-flags.ts`, add a line to `FLAG_KEYS` (after `HOME_LIVE_TOURNAMENTS_CAROUSEL` to keep home flags grouped):

```ts
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
  HOME_TOURNAMENT_SPOTLIGHT:      'home_tournament_spotlight',
  NEWS_PIPELINE_ENRICHMENT:       'news_pipeline_enrichment',
  FORYOU_ENABLED:                 'foryou_enabled',
  SUGGEST_A_SOURCE_BUTTON:        'suggest_a_source_button',
  HOME_NEWS_IMMERSIVE_LINK:       'home_news_immersive_link',
  PROJECTION_ENABLED:             'projection_enabled',
  PROJECTION_VOTE_ENABLED:        'projection_vote_enabled',
  MATCH_PREDICTION_ENABLED:       'match_prediction_enabled',
} as const
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```
Expected: no NEW errors referencing `feature-flags.ts` (the key is a string literal addition; pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add src/lib/feature-flags.ts
git commit -m "feat(flags): add HOME_TOURNAMENT_SPOTLIGHT flag key"
```

---

### Task 3: Fetch + resolve the spotlight flag in the home page

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx` — flag query (~347-354), flag resolution (~496-510), new state (~148)

This task wires the data; the render gate is Task 4. After this task the flag is read but not yet used in JSX (no visible change — safe intermediate commit).

- [ ] **Step 1: Add `spotlightEnabled` state**

In `src/app/[locale]/(app)/home/page.tsx`, directly below the `carouselEnabled` state at line 148:

```ts
  const [carouselEnabled, setCarouselEnabled] = useState<boolean>(false)
  const [spotlightEnabled, setSpotlightEnabled] = useState<boolean>(false)
```

- [ ] **Step 2: Merge the spotlight key into the carousel flag query**

Replace the existing carousel-flag query block (currently lines ~345-354):

```ts
        // Feature flag — controls whether the Live Tournaments carousel
        // renders. Two columns (enabled, enabled_local) resolved by host.
        wrap(
          supabase
            .from('feature_flags')
            .select('enabled, enabled_local')
            .eq('key', FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL)
            .maybeSingle() as any,
          'home:carousel-flag',
        ),
```

with a single multi-key fetch (keeps array index 10 stable for all downstream `dataOf()` calls):

```ts
        // Feature flags for the home page, fetched in one round-trip:
        //   - HOME_LIVE_TOURNAMENTS_CAROUSEL → the Live Tournaments carousel
        //   - HOME_TOURNAMENT_SPOTLIGHT      → the Tournament Spotlight hero
        // Each row carries (enabled, enabled_local); resolveFlag picks the
        // column by host. Returns 0–2 rows; resolution below keys by `key`.
        wrap(
          supabase
            .from('feature_flags')
            .select('key, enabled, enabled_local')
            .in('key', [
              FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL,
              FLAG_KEYS.HOME_TOURNAMENT_SPOTLIGHT,
            ]) as any,
          'home:home-flags',
        ),
```

- [ ] **Step 3: Replace the flag-resolution block**

Replace the current resolution block (currently lines ~496-510, the `const flagRow = dataOf(10)` through the `setCarouselEnabled(...)` call):

```ts
      // Resolve home feature flags — dataOf(10) is an array of
      // { key, enabled, enabled_local } rows (0–2). Key by `key`;
      // resolveFlag() picks enabled vs enabled_local by hostname and
      // defaults missing rows to false (safe-off).
      const flagRows = dataOf(10) as Array<{
        key: string
        enabled?: boolean | null
        enabled_local?: boolean | null
      }>
      const resolveByKey = (key: string): boolean => {
        const row = Array.isArray(flagRows) ? flagRows.find(r => r.key === key) : undefined
        return resolveFlag(
          row ? { enabled: row.enabled ?? null, enabled_local: row.enabled_local ?? null } : null,
        )
      }
      setCarouselEnabled(resolveByKey(FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL))
      setSpotlightEnabled(resolveByKey(FLAG_KEYS.HOME_TOURNAMENT_SPOTLIGHT))
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```
Expected: no NEW errors in `home/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/home/page.tsx"
git commit -m "feat(home): fetch + resolve home_tournament_spotlight flag"
```

---

### Task 4: Gate the spotlight render on the flag

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx:668-681` (the Tournament Spotlight Hero block)

- [ ] **Step 1: Add the flag to the render condition**

Change the spotlight block's opening condition (currently line ~669, `{spotlightTournament && (`) so both the `SectionTitle` heading and the hero are gated. The closing `</>` and `)}` at lines ~680-681 stay unchanged:

```tsx
      {/* ── TOURNAMENT SPOTLIGHT HERO ──────────────────────── */}
      {spotlightEnabled && spotlightTournament && (
        <>
          <SectionTitle action={tHome('fullEvents')} href="/tournaments">{tHome('tournamentSpotlight')}</SectionTitle>
          <TournamentSpotlightHero
            tournament={spotlightTournament}
            defendingChampionMen={spotlightChampionMen}
            defendingChampionWomen={spotlightChampionWomen}
            topSeeds={[]}
            stats={null}
            hasLiveMatches={liveMatches.some(m => (m as any).tournament_id === spotlightTournament.id || (m as any).tournament?.id === spotlightTournament.id)}
          />
        </>
      )}
```

- [ ] **Step 2: Lint**

Run:
```bash
npm run lint 2>&1 | tail -20
```
Expected: no NEW lint errors for `home/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/home/page.tsx"
git commit -m "feat(home): gate Tournament Spotlight hero behind feature flag"
```

---

### Task 5: Verify behavior in the running app

**Files:** none (verification only).

This is the real test for this change (client component + Supabase data load — no meaningful pure-function unit to TDD; `resolveFlag` is already unit-tested). Use the preview tooling per the repo's "test locally always" rule.

- [ ] **Step 1: Start the dev server and load the home page**

Start the server (`npm run dev`, localhost:3002) via the preview tooling and navigate to the home page (`/` or `/es`).

- [ ] **Step 2: Confirm flag OFF hides the spotlight**

With the flag at its default (`enabled_local = false`), take a snapshot/screenshot of the home page.
Expected: **no** "Tournament Spotlight" / "TORNEO DESTACADO" heading and **no** `TournamentSpotlightHero` between Latest News and Rankings. The Rankings section follows Latest News directly.

- [ ] **Step 3: Confirm flag ON restores the spotlight (local column)**

Flip the local switch so the spotlight shows on localhost:
```bash
psql "$DATABASE_URL" -c "update public.feature_flags set enabled_local = true where key = 'home_tournament_spotlight';"
```
Reload the home page (hard reload — the flag cache TTL is ~60s, but the home query is fresh per load). Take a snapshot/screenshot.
Expected: the "Tournament Spotlight" heading **and** the hero render again, above Rankings.

- [ ] **Step 4: Reset local column back to OFF**

```bash
psql "$DATABASE_URL" -c "update public.feature_flags set enabled_local = false where key = 'home_tournament_spotlight';"
```
Reload; confirm the spotlight is hidden again.

- [ ] **Step 5: Confirm the flag appears in the ops Feature Flags tab**

Navigate to the ops dashboard Feature Flags tab (authenticated via `?token=$CRON_SECRET`). 
Expected: a "Home · Tournament Spotlight hero" row with working Production + Local toggles.

- [ ] **Step 6: Production build**

Run:
```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds (no type/render errors introduced).

---

## Self-Review Notes

- **Spec coverage:** Migration (Task 1) ✓, flag key (Task 2) ✓, home fetch+resolve merged into one query (Task 3) ✓, render gate incl. heading (Task 4) ✓, no admin code change + local/prod verification (Task 5) ✓. All spec sections covered.
- **Index stability:** Task 3 keeps the merged flag query at the same array position (index 10) so every other `dataOf(n)` index is unchanged. Resolution switches from single-object to array-of-rows — handled in Step 3.
- **Default safe-off:** `resolveFlag(null)` returns `false`, so a missing row or fetch failure hides the spotlight (matches "OFF" intent).

# Coaches Card on the Public Player Profile — Design

**Date:** 2026-10-02
**Status:** Approved in chat, spec awaiting Gustavo's review
**Builds on:** `2026-10-02-coach-normalization-design.md` (coaches, coach_aliases, player_coaches — live in prod since 2026-10-02, PR #635)

## Goal

Show a player's coaches on the public player profile (`src/app/[locale]/player/[id]/page.tsx`), using the canonical coach records, not the raw FIP text.

## Decisions (2026-10-02)

1. **Placement: a "Coaches" card on the Overview tab** (option B), right after the Current Partner card. When there is no current partner it sits right after Road to Trophy. Full width (`<Widget wide>`), same look as Current Partner / Plays With.
2. **Names only.** One line per coach, in FIP list order (`player_coaches.position`). No "also coaches …" and no other players — that belongs on the coach page (Phase 2).
3. **No links yet.** Names are plain text; they become links to `/coach/[slug]` when coach pages ship.
4. **Label:** "Coach" for one coach, "Coaches" for two or more. Localised in all 5 locales.
5. **Hidden when empty.** No coaches, or only junk/merged ones → the card does not render (≈72% of players today).
6. **Canonical data, not raw text.** Shows one entry per real coach (variant spellings collapsed, junk excluded) instead of `players.coaches`.

## Data access

The profile runs on the browser **anon** Supabase client. The coach tables have RLS on with no anon policy (by design, Phase 1). We expose a narrow read-only view instead of opening the tables:

```sql
-- supabase/migrations/20261002130000_player_coaches_public.sql
create or replace view public.player_coaches_public as
select pc.player_id, pc.position, c.id as coach_id, c.display_name, c.slug
from public.player_coaches pc
join public.coaches c on c.id = pc.coach_id
where c.status in ('unreviewed', 'verified');

grant select on public.player_coaches_public to anon, authenticated;
```

- **Owner-rights view (not `security_invoker`)** on purpose: it reads the RLS-locked tables as the view owner, and only these 5 columns ever leave. `notes`, `avatar_url`, `country`, `normalized_name`, aliases and both suggestion tables stay private. Supabase's advisor flags owner-rights views; this one is intentional and documented in the migration comment.
- Status filter excludes `junk` and `merged`. A merged coach has no `player_coaches` rows anyway (merge moves them), so this is belt-and-braces.
- No write grants. Tables stay exactly as locked as before.
- Unreviewed coaches are shown: they are real FIP coach names, just not yet human-checked. Junk is the only thing hidden.

## UI

- New component `src/app/[locale]/player/[id]/CoachesCard.tsx`: props `{ coaches: { coach_id: string; display_name: string }[] }`, renders `null` when empty, else `<Widget wide label={...}>` with one name per line (same text styling as the Current Partner name).
- `page.tsx`: one extra query in the existing parallel profile load (next to the equipment query):
  `supabase.from('player_coaches_public').select('coach_id, display_name, position').eq('player_id', id).order('position')`.
  Failure is best-effort: on error, log and render no card — never break the profile.
- Insert `<CoachesCard>` in the Overview grid after the Current Partner block.
- i18n: `player.coach` / `player.coaches` keys in `src/messages/{en,es,pt,it,fr}.json` (en "Coach"/"Coaches", es "Entrenador"/"Entrenadores", pt "Treinador"/"Treinadores", it "Allenatore"/"Allenatori", fr "Entraîneur"/"Entraîneurs").

## Testing

- **Component test** (`CoachesCard`): 0 coaches → renders nothing; 1 → singular label + name; 2 → plural label + both names in given order.
- **Migration check** (rollback-only script, same pattern as `scripts/verify-coaches-migration.ts`): as role `anon`, `select` on the view works and returns only the 5 columns; `select` on `coaches`, `coach_aliases`, `coach_merge_suggestions` still returns nothing; a junk coach linked to a player does not appear in the view.
- **Browser (local, prod data):** Tapia (2 coaches → "Coaches", Pratto + Canali), a one-coach player ("Coach"), a player with no coaches (no card), Chevaan Davids (self-listed coach shows), mobile width, the 5 locales' labels.

## Rollout

1. Migration applied via pg + `DATABASE_URL` — on Gustavo's go-ahead.
2. PR → merge → web deploy (`scripts/deploy.sh web` from a checkout **outside** `.claude/`) — on Gustavo's go-ahead.
Admin and padelgod are untouched.

## Out of scope

Coach pages (`/coach/[slug]`), links, coach avatars, "also coaches", coach in the hero or Profile Info, coach on the match page, SEO/JSON-LD for coaches.

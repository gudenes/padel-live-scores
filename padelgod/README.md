# Padelgod

Padel data scraping service for PadelNachos. Sources tournaments, players, draws, OOP, and live scores from FIP/Crionet, writes directly to the shared Supabase database. Runs as a long-running Node.js service on Railway, separate from the main Next.js app.

## Getting started

```bash
cd padelgod
npm install
cp .env.example .env
# fill in real Supabase + admin token values
npm run dev
```

Visit `http://localhost:3003/health` to confirm it's up. (Port 3003 avoids colliding with the main Next.js dev server on 3002.)

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with file watcher (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled build |
| `npm test` | Run vitest test suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | TypeScript check, no emit |

## Environment variables

See `.env.example`. The required ones:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — reuse from main app
- `PADELGOD_ADMIN_TOKEN` — admin API auth (generate via `openssl rand -hex 32`)

## Deployment

Railway service `padelgod` is connected to this directory. Pushing to `main` triggers an automatic build (Dockerfile-based) and deploy.

## Structure

```
src/
├── api/         # HTTP route handlers (Fastify)
├── lib/         # Shared utilities (env, logger, supabase, types)
├── workers/     # Cron + continuous workers (added in Plan 2+)
└── index.ts     # Entry point
```

## Specs

Design lives at `docs/superpowers/specs/2026-04-20-padelgod-*.md`.

## What this service does NOT do

- Doesn't replace `/relay/` yet — both run in parallel during migration
- Doesn't handle Premier `beforeauth` API calls (separate Vercel cron stays put)
- Doesn't handle app-internal crons (social drafts, editorial, quality scores) — those stay on Vercel

### Puntuate live scores (Melilla)

The `puntuate-live-fetcher` follows the Webtuga pipeline: fetch → resolve existing
matches → adapt → diff/apply → guarded live transition and notification. It polls
once every 30 seconds, only for tournaments mapped with `source=puntuate_live`.
It writes live scores; the existing FIP pipeline remains responsible for finals.
Finished/disappeared cards never trigger completion here. The match recap is
hidden for Puntuate, as it is for Webtuga's incomplete point history.

Puntuate returns server-rendered HTML. The full scoreboard (without `enjuego=1`)
provides dates and all match statuses. Matching requires both players of both
teams, category, and a unique orientation. Ambiguous or terminal matches are
skipped. Cache state is keyed by the resolved canonical match ID because the
source has no match IDs. Scores, current points, serving side, and 6–6 tiebreaks
are supported; this polling feed does not provide complete point history.

From `padelgod/`, with Supabase service credentials in the environment:

```sh
# Read-only; defaults to discovering October 2026 Melilla by name/date.
npx tsx --env-file=../.env.local scripts/dryrun-puntuate.ts

# Register the verified Melilla tournament mapping.
npx tsx --env-file=../.env.local scripts/onboard-puntuate-tournament.ts \
  1c4fff81-019d-4501-803a-319baec89dfd \
  'https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310'
```

Deploy the worker and set `ENABLE_PUNTUATE_LIVE=true`. Keep
`PUNTUATE_LIVE_DRY_RUN=true` for verification, then set it to `false` to write.
Both default to safe/off settings. Manual worker execution always dry-runs.
Disable `ENABLE_PUNTUATE_LIVE` to stop polling. No schema migration is needed.

The captured 2026-10-21 fixture covers 29 cards (19 finished, 3 live, 7 scheduled).
Live preflight resolved all 3 live matches against 64 canonical draw matches,
with no ambiguous or unresolved matches. This verifies reading, resolution and
adaptation, not production writes.

Live cards without set scores update status and trigger notifications without inventing scores.

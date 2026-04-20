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

Visit `http://localhost:3002/health` to confirm it's up.

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

# Padel Live Scores — Week 1 Progress Log

## Status: Week 1 Complete ✅
**Date:** March 20, 2026
**Session duration:** ~3 hours
**Next session:** Week 2 — Mobile UI

---

## What We Built

### Infrastructure
- [x] Node.js v20 installed via nvm
- [x] Next.js 16.2.0 project created (`padel-live-scores`)
  - TypeScript, Tailwind CSS, App Router, src/ directory
  - Located at: `~/Downloads/padel-live-scores`
- [x] Supabase project created
  - URL: `https://jwqaesjjoghzobngxejn.supabase.co`
- [x] `.env.local` configured with all keys
- [x] `@supabase/supabase-js` installed

### Database
- [x] Schema deployed to Supabase (via SQL Editor)
- [x] 6 tables created:
  - `tournaments` — tournament metadata
  - `players` — player profiles
  - `matches` — match state, pairs, status, pusher channel
  - `sets` — set scores per match
  - `games` — game scores + point arrays per set
  - `match_presence` — who is watching each match
- [x] Indexes on all foreign keys and status fields
- [x] Row Level Security (RLS) enabled
  - Public read on all match data
  - Service role only for writes
- [x] Supabase Realtime enabled on `matches`, `sets`, `games`, `match_presence`
- [x] `updated_at` triggers on all tables

### Score Agent
- [x] API route created at `src/app/api/cron/scores/route.ts`
- [x] `vercel.json` configured for cron (every minute)
- [x] Stub data with 3 realistic matches:
  - Match 1001: Galán/Lebrón vs Lima/Stupaczuk (QF, Court 1)
  - Match 1002: Coello/Tapia vs Di Nenno/Capra (QF, Court 2)
  - Match 1003: Ortega/Sánchez vs Triay/Jensen (QF, Court 3)
- [x] Full upsert pipeline: tournaments → players → matches → sets → games
- [x] Tested and confirmed: `{"synced":3,"failed":0,"total":3,"mode":"stub"}`

---

## Data Source Decision

**Using stub data for now** — padelapi.org live endpoint requires a paid subscription (402 Payment Required on free tier). Decision: build and validate full UI with stub data, upgrade padelapi.org plan when ready to go live.

**padelapi.org account exists** — API token generated and stored in `.env.local`.

When ready to switch to real data:
1. Upgrade padelapi.org plan
2. Replace stub logic in `route.ts` with real `fetchLiveMatches()` call
3. Add Pusher Relay Agent for WebSocket point-by-point updates

---

## File Structure

```
padel-live-scores/
├── .env.local                          # keys — never commit
├── vercel.json                         # cron config
├── schema.sql                          # DB schema reference
├── padel-project-context.md            # architecture doc
├── src/
│   └── app/
│       └── api/
│           └── cron/
│               └── scores/
│                   └── route.ts        # Score Agent ✅
└── package.json
```

---

## Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jwqaesjjoghzobngxejn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # public, safe for frontend
SUPABASE_SERVICE_KEY=sb_secret_...                  # private, agents only
PADELAPI_TOKEN=...                                  # padelapi.org token
CRON_SECRET=30143014                                # protects cron in production
```

---

## Key Technical Decisions Made

**Supabase as the hub** — all data flows through Supabase. Clients never connect directly to padelapi.org or Pusher. This gives one source of truth and lets us enrich data before it reaches the UI.

**Service key for agents, anon key for frontend** — agents (Score, Relay, Alerts) use `SUPABASE_SERVICE_KEY` to bypass RLS and write data. The client UI uses `SUPABASE_ANON_KEY` and only reads public data.

**Stub-first development** — build the entire UI against realistic fake data. Swap in real API when paid plan is ready. Avoids blocking on external service costs during MVP.

**`raw_payload jsonb` on matches** — stores the full padelapi.org response. Safety net for when the real API shape differs from our assumptions.

---

## Blockers / Notes

- padelapi.org live endpoint needs paid plan — using stub data until then
- Contact: ferran@padelapi.org to ask about pricing
- Turbopack cache issue encountered — fixed with `rm -rf .next`
- Dev server runs on port 3000 (or 3001 if 3000 is taken)

---

## Week 2 Plan — Mobile UI

### Goal
A mobile-first page showing live matches in real time. Tap to expand.

### Tasks
- [ ] Supabase client helper (`src/lib/supabase.ts`)
- [ ] Matches list page (`src/app/page.tsx`) — mobile card layout
- [ ] Match card component — shows players, current score, set scores
- [ ] Tap to expand — inline detail with games and points
- [ ] Supabase Realtime subscription — live score updates without reload
- [ ] "X people watching" presence indicator

### Key files to create
```
src/
├── lib/
│   └── supabase.ts          # Supabase client (anon + server)
├── types/
│   └── match.ts             # TypeScript types for match data
└── app/
    ├── page.tsx             # Matches list (home)
    └── components/
        ├── MatchCard.tsx    # Collapsed match card
        └── MatchDetail.tsx  # Expanded match detail
```

# Padel Live Scores — Project Context

## What We're Building
A mobile-first Progressive Web App (PWA) for tracking live Padel scores. Browser-based MVP first, native app later. Built to scale using an agent-based architecture where each concern is isolated and swappable.

**MVP timeline:** 4 weeks, ~4 hours/day (~16h/week)

---

## Tech Stack

| Layer | Tool | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) | React, mobile-first, works as PWA |
| Database | Supabase (Postgres) | Managed DB + built-in Realtime |
| Live sync | Supabase Realtime | WebSocket broadcast to all clients |
| Auth | Supabase Auth | User sessions, anonymous presence |
| Deploy | Vercel | Edge CDN, cron jobs, zero config |
| Data source | padelapi.org | Official FIP/Premier Padel data, clean JSON API |
| Live push | Pusher (via padelapi.org) | WebSocket per match, every point update |
| Language | TypeScript throughout | |
| Styling | Tailwind CSS | Mobile-first utility classes |

---

## Data Source: padelapi.org

**Not the official FIP API** — it's a third-party aggregator built by Fantasy Padel Tour, but it's the best developer-friendly option available.

### Why we chose it over scraping matchscorerlive.com
- Returns clean JSON (not HTML)
- Has a versioned, documented API
- Provides WebSocket push via Pusher (no polling needed)
- Covers FIP major, p1, p2, fip_platinum, fip_gold tournaments

### Key endpoints
```
GET /api/live                     → all currently live matches
GET /api/matches/{id}/live        → point-by-point state for one match
```

### Live match response shape
```json
{
  "id": 7243,
  "status": "live",
  "coverage": "full",
  "channel": "matches.7243",
  "sets": [
    {
      "set_number": 1,
      "set_score": "6-2",
      "games": [
        {
          "game_number": 1,
          "game_score": "0 - 0",
          "points": ["15:0", "30:0", "40:15"]
        }
      ]
    }
  ]
}
```

### Pusher WebSocket details
- App Key: `0ffbefeb945e4e466065`
- Cluster: `eu`
- Channel format: `matches.{matchId}`
- Event: `App\PadelApi\Events\MatchLiveUpdated`
- Channels are **public** — no auth handshake needed

### Rate limits (free tier)
- 10 req/min, 2,000 req/day, 50,000 req/month

### Authentication
```
Authorization: Bearer YOUR_API_TOKEN
```

---

## Agent Architecture

Three agents, each with a single responsibility. For MVP they are simple functions. Claude API can be added to any of them later without touching the others.

### Score Agent
- **What:** Polls `GET /api/live` every 60 seconds via Vercel cron
- **Does:** Upserts new/changed matches into Supabase
- **Also:** Subscribes the Pusher Relay to any newly discovered live match channels
- **Lives in:** `app/api/cron/scores/route.ts`

### Pusher Relay Agent
- **What:** Long-running process holding open WebSocket connections to `matches.{id}` for every live match
- **Does:** Receives every point update from padelapi.org, writes directly to Supabase
- **Lives in:** Supabase Edge Function (or small Node.js service on Vercel)

### Alerts Agent (Week 4)
- **What:** Reacts to Supabase DB changes
- **Does:** Sends push notifications (FCM/Web Push) when score changes
- **Claude API hook:** Generate smart notification text instead of "Score changed"
- **Lives in:** Supabase Database Webhook → Edge Function

### Data flow
```
padelapi.org
    ├── REST (every 60s) → Score Agent → Supabase → Realtime → Client
    └── Pusher WS (every point) → Relay Agent → Supabase → Realtime → Client
```

---

## 4-Week Sprint Plan

### Week 1 — Foundation
- Supabase project setup, schema, RLS policies
- Next.js 14 project init on Vercel
- Supabase Auth (anonymous + email)
- Score Agent stub writing fake data to DB
- Goal: data flows end-to-end with fake scores

### Week 2 — Real-time engine
- Score Agent polls real padelapi.org endpoint
- Pusher Relay Agent subscribes to live match channels
- Supabase Realtime broadcasts changes
- Goal: see live point updates in a browser tab

### Week 3 — Mobile UI
- Matches list page (mobile-first, live cards)
- Tap-to-expand match detail (sets, games, points)
- Supabase Presence for "X people watching" feature
- Goal: full mobile UX working end-to-end

### Week 4 — Polish + PWA
- PWA manifest, install prompt, offline fallback
- Alerts Agent + push notifications
- Performance pass
- Deploy to production URL

---

## Key Architecture Decisions

**Why agents instead of one monolith:** Each agent owns one concern. Score ingestion, state management, and notifications can each be swapped, scaled, or upgraded (e.g. with Claude API) independently.

**Why Supabase Realtime as the hub:** Instead of clients connecting directly to Pusher, all updates flow through Supabase. This means one source of truth, offline resilience, and the ability to enrich data before it reaches clients.

**Claude API — when to add it:**
- Weeks 1–3: zero Claude API in agents, keep it fast and cheap
- Week 4: add Claude to Alerts Agent only — one API call per meaningful score event to generate smart push notification text (e.g. "Galán & Lebron just broke serve in the 3rd, one game from the title")
- Model to use: `claude-sonnet-4-20250514`, max_tokens: 1000

**PWA over native app for MVP:** Installable on iOS and Android from the browser. No App Store review, no separate codebase. Native app is the next phase.

---

## Coding Conventions

- **Language:** TypeScript everywhere
- **Framework:** Next.js 14 App Router (not Pages Router)
- **Supabase client:** `@supabase/supabase-js` v2
- **Agents:** Next.js API routes unless stated otherwise
- **Style:** Mobile-first Tailwind CSS
- **Code quality:** Production-ready but lean — no over-engineering for MVP

---

## Environment Variables Needed

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=        # for server-side agents only
PADELAPI_TOKEN=              # from padelapi.org
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Current Status
- [x] Architecture designed
- [x] Tech stack decided
- [x] Data source selected (padelapi.org)
- [x] Agent roles defined
- [x] Sprint plan created
- [ ] Supabase account created ✅ (user has account)
- [ ] Supabase schema — **next step**
- [ ] padelapi.org account + API token
- [ ] Next.js project init

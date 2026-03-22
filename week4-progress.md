# PadelNacho — Week 4 Progress

## Status: Week 4 In Progress
**Date:** March 22, 2026  
**Live URL:** https://padel-nacho.vercel.app  
**Repo:** https://github.com/gudenes/padel-live-scores

---

## What We Built This Session

### Infrastructure & Workflow
- **GitHub repo created** — `gudenes/padel-live-scores` (public)
- **GitHub PAT configured** — direct file pushes via browser API each session
- **Vercel cron slowed to every 2 minutes** — was every 1 min, halved API pressure (`*/2 * * * *`)
- **Project context doc** added to repo for session continuity

### Design System — Full Token Swap
Replaced all hardcoded hex values with CSS variables across all 3 main files:

| File | Status |
|------|--------|
| `src/app/page.tsx` | ✅ Tokenized |
| `src/app/components/MatchCard.tsx` | ✅ Tokenized |
| `src/app/match/[id]/page.tsx` | ✅ Tokenized |

All colors now reference `globals.css` variables:
- Backgrounds: `var(--bg-base)`, `var(--bg-card)`, `var(--bg-card-alt)`, `var(--bg-input)`
- Text: `var(--text-primary)` → `var(--text-invisible)` (7-stop scale)
- Colors: `var(--color-live)`, `var(--color-success)`, `var(--color-men)`, `var(--color-women)`, etc.
- Fonts: `var(--font-sans)`, `var(--font-mono)`

### Readability Audit — 6 Fixes
Full contrast and hierarchy audit based on WCAG AA guidelines:

| Issue | Before | After |
|-------|--------|-------|
| Loser names | `#444` (~1.8:1 contrast) | `#777` |
| Loser scores | `#2a2a2a` (invisible) | `#555` |
| "Finished" label | `#3a3a3a` | `#666` uppercase |
| Stage pill | `#2a2a2a` | `#888` with border |
| Section headers (TODAY/UP NEXT) | `#555` 11px | `#aaa` 11px |
| Court/round/date in match detail | `#333–#444` | `#666–#888` |
| Stat labels (Side/Rank/Win/Matches) | `#3a3a3a` 9px | `#666` 10px |
| "After previous" in scheduled | `13px bold green` | `10px muted #555` |

### Match Detail Hero — Concept C Revamp
Replaced single round avatar + stacked names with:
- Two **56×56 square photos** per pair (rounded corners)
- Both players named at **equal weight** side by side
- Winner pair: green border on photos
- Players tab: 4 individual stat cards (no photos — already visible in hero)

### Feed Cards — Total Score Display
Added sets-won total score (2-0, 2-1) to all finished match cards:
- **Set scores** shown smaller (13px, slightly dimmed) on the left
- **Total sets won** shown large (20px bold) on the right, separated by a divider
- S1/S2/S3 column headers aligned above set game scores
- Live matches: unchanged (full size scores + points)

### API Rate Limit Handling
Implemented full rate limit protection in `cron/scores/route.ts`:

```typescript
// Tracks remaining requests in memory
let _rateLimitRemaining: number = 100
let _rateLimitResetAt: number = 0

// All padelapi fetches go through this wrapper
async function fetchWithRateLimit(url, options): Promise<Response>

// Checked at the top of every cron run
function isRateLimited(): boolean
```

- Reads `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on every response
- Skips cron run entirely if remaining ≤ 2
- On 429 response: records `Retry-After` time, backs off automatically
- `match-stats/route.ts`: returns proper 429 to client instead of 500

### Admin Routes Added

| Route | Usage |
|-------|-------|
| `/api/admin/resync` | Re-fetches all datapoints for recent matches |
| `/api/admin/resync?hours=48` | Resync last 48 hours |
| `/api/admin/resync?tournament=727` | Resync entire tournament |
| `/api/admin/resync?match=7383` | Resync single match |

Resync fixes in one shot: orphan null sets, set scores, player data, match status, winner, duration.

---

## Bugs Fixed

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Matches showing 1-0 instead of 2-0 | Null sets from live tracking not cleaned up | Count sets won from `set_score !== null` only |
| Tournament not showing as live | `starts_at` / `ends_at` were null in DB | Patched directly via SQL |
| Rate limit ban (3+ hours) | Cron every 1min + manual triggers + browser direct calls | 2min cron + rate limit backoff + no more direct browser API calls |
| `.env.local` token not picked up | Next.js cache not cleared | `rm -rf .next` before restart |
| `Icon\r` files in `.next` cache | macOS junk files committed to repo | `rm -rf .next` resolves at runtime |

---

## Pending

- [ ] **Re-enable Vercel cron** once padelapi confirms ban lifted
- [ ] **Run resync** `?tournament=727` to clean up all orphan null sets
- [ ] **Clean up `Icon\r` files** from the repo root
- [ ] **Player dedup** — accent vs non-accent name variants
- [ ] **Pusher relay** — sub-second point updates instead of 2min polling

---

## Key Commands

```bash
# Local dev
cd ~/Downloads/padel-live-scores
npm run dev

# Clear cache and restart
rm -rf .next && npm run dev

# Deploy
vercel --prod

# Trigger cron manually (local)
curl -H "Authorization: Bearer 30143014" http://localhost:3000/api/cron/scores

# Trigger cron manually (production)
curl -H "Authorization: Bearer 30143014" https://padel-nacho.vercel.app/api/cron/scores

# Seed full tournament
curl -s "http://localhost:3000/api/admin/seed-tournament?tournament=727" | python3 -m json.tool

# Resync last 24 hours
curl -s "http://localhost:3000/api/admin/resync" | python3 -m json.tool

# Resync full tournament
curl -s "http://localhost:3000/api/admin/resync?tournament=727" | python3 -m json.tool

# Resync single match
curl -s "http://localhost:3000/api/admin/resync?match=7383" | python3 -m json.tool

# Check tournament data
curl -s "https://jwqaesjjoghzobngxejn.supabase.co/rest/v1/tournaments?select=*" \
  -H "apikey: sb_publishable_o_0VFXibo7W19l_pRi30RQ_iXdOfhBF" \
  -H "Authorization: Bearer sb_publishable_o_0VFXibo7W19l_pRi30RQ_iXdOfhBF" | python3 -m json.tool
```

## Key SQL

```sql
-- Fix tournament dates
UPDATE tournaments
SET starts_at = '2026-03-16', ends_at = '2026-03-22', name = 'Cancún P2 2026'
WHERE external_id = '727';

-- Find matches with orphan null sets
SELECT m.external_id, m.winner_pair,
       COUNT(s.id) as total_sets,
       COUNT(s.set_score) as scored_sets
FROM matches m
JOIN sets s ON s.match_id = m.id
WHERE m.status = 'finished'
GROUP BY m.id, m.external_id, m.winner_pair
HAVING COUNT(s.id) != COUNT(s.set_score)
ORDER BY m.external_id;

-- Check scheduled matches
SELECT external_id, scheduled_at, schedule_label, round, status, court_order
FROM matches
WHERE status = 'scheduled'
ORDER BY court_order;
```

---

## File Changes This Session

```
src/app/page.tsx                          ← Design tokens + readability fixes
src/app/components/MatchCard.tsx          ← Tokens + readability + total score + Concept C hero
src/app/match/[id]/page.tsx              ← Tokens + readability + two-photo hero + stat cards
src/app/api/cron/scores/route.ts         ← Rate limit handling + 2min cron
src/app/api/match-stats/route.ts         ← Proper 429 propagation
src/app/api/admin/resync/route.ts        ← NEW: full resync route
vercel.json                              ← Cron every 2 minutes
```

---

## URLs
- **Production:** https://padel-nacho.vercel.app
- **Supabase:** https://jwqaesjjoghzobngxejn.supabase.co
- **GitHub:** https://github.com/gudenes/padel-live-scores
- **padelapi.org docs:** https://padelapi.org/docs

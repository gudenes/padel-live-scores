# Padel Live Scores — Week 2 Complete + Roadmap

## Status: Week 2 Complete ✅
**Date:** March 20, 2026
**Next session:** Week 3 — Mobile polish + deploy

---

## What We Built This Week

### New files
```
src/
├── lib/
│   └── supabase.ts              # Supabase browser + server clients
├── types/
│   └── match.ts                 # TypeScript types + helper functions
└── app/
    ├── page.tsx                 # Live matches home page with Realtime
    └── components/
        └── MatchCard.tsx        # Tap-to-expand live score card
```

### What's working
- 3 live stub matches displaying with real player names
- Set scores (completed and in-progress)
- Current game point highlighted in green
- Deuce/advantage display (A:40)
- Tap to expand — set breakdown, game points, full player names
- "X watching" presence counter
- Supabase Realtime subscription active
- Skeleton loading + empty state
- Works on real phone via local network (192.168.1.169:3000)

---

## Bugs Fixed

**Silent DB writes** — new `sb_secret_...` key doesn't bypass RLS.
Fix: use legacy `service_role` JWT from Project Settings → API → Legacy tab.

**Player names showing TBD** — simple `select(*)` doesn't follow multiple FK refs to same table.
Fix: explicit join syntax with constraint names.

**Phone blocked** — Next.js blocks cross-origin dev requests by default.
Fix: add `allowedDevOrigins: ["192.168.1.169"]` to `next.config.ts`.

**Turbopack cache corruption** — `Icon\r` file causes startup errors.
Fix: `rm -rf .next` before `npm run dev`.

---

## Current next.config.ts
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.169"],
};

export default nextConfig;
```

---

## Decisions Made

**No PWA yet** — web version first, validate with real users, add PWA install only when people ask for it. Saves complexity now.

**Stub data stays until padelapi.org paid plan** — full pipeline works end to end, just swap the data source when ready.

**Deploy before polish** — get a real URL first so real people can test it, then fix what actually bothers them.

---

## Full Roadmap (replanned)

### Week 3 — Mobile polish + deploy
- [ ] Test on real phone — note anything broken or cramped
- [ ] Fix mobile layout issues found during testing
- [ ] Add tournament name to match cards
- [ ] Score change animation (flash green on update)
- [ ] Realtime live test — update a score in Supabase Table Editor, verify UI updates without reload
- [ ] Branding — app name, colors, typography decision
- [ ] Deploy to Vercel — get a public URL

### Week 4 — Real data + notifications
- [ ] Upgrade padelapi.org plan (contact: ferran@padelapi.org)
- [ ] Swap stub data for real padelapi.org live endpoint
- [ ] Add Pusher Relay Agent for point-by-point WebSocket updates
- [ ] Alerts Agent — Claude API generates smart push notification text
- [ ] Share URL with real padel fans, collect feedback

### Post-MVP (after validation)
- [ ] PWA manifest + icons — installable on iOS/Android
- [ ] Native app — only if PWA isn't enough
- [ ] User accounts + favourite matches
- [ ] Historical results
- [ ] Player profiles + stats

---

## Key Commands

```bash
# Start dev server
npm run dev

# Clear cache if startup fails
rm -rf .next && npm run dev

# Seed stub data
open http://localhost:3000/api/cron/scores

# Test on phone (same WiFi)
open http://192.168.1.169:3000
```

## Key URLs
- Local: http://localhost:3000
- Phone: http://192.168.1.169:3000
- Supabase: https://jwqaesjjoghzobngxejn.supabase.co
- padelapi.org docs: https://padelapi.org/docs

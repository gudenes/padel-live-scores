# Final Score Inference Rule — Implementation Guide

## Overview

This implementation adds a **post-processing inference layer** to the PadelNacho scoring pipeline. When a match is `finished` but the last set score is still `null` (due to the API finish-transition race condition), the system infers the correct score from the last recorded point data.

## Files in this package

### New files (copy to your repo)

| File | Destination | Purpose |
|---|---|---|
| `src/lib/score-inference.ts` | `src/lib/score-inference.ts` | Core inference logic (pure functions + DB-aware functions) |
| `src/lib/__tests__/score-inference.test.ts` | `src/lib/__tests__/score-inference.test.ts` | Unit tests for all pure functions |
| `supabase/migrations/20260327_add_score_source.sql` | Run in Supabase SQL editor | Add `score_source` column + index |

### Integration patches (apply to existing files)

| File | Target | What to change |
|---|---|---|
| `src/app/api/cron/scores/INTEGRATION_PATCH.ts` | `scores/route.ts` | 4 changes: import, inference fallback, reconciliation, score_source |
| `relay/INTEGRATION_PATCH.js` | `relay/index.js` | 2 changes: helper functions, finished event handler |
| `src/app/api/cron/sync/INTEGRATION_PATCH.ts` | `sync/route.ts` | 2 changes: score_source on upserts, skip condition |

## Step-by-step integration

### Phase 1 — Database migration (no code changes needed)

1. Open Supabase SQL Editor
2. Run `supabase/migrations/20260327_add_score_source.sql`
3. Verify: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sets' AND column_name = 'score_source';`

### Phase 2 — Add the new module

1. Copy `src/lib/score-inference.ts` to your repo
2. Run tests: `npx vitest run src/lib/__tests__/score-inference.test.ts`
3. All 30+ tests should pass (pure functions, no DB needed)

### Phase 3 — Wire into Score Agent (`scores/route.ts`)

Apply the 4 changes from `INTEGRATION_PATCH.ts`:

**Change 1 — Import** (top of file):
```typescript
import { inferFinalScore, inferBatch } from '@/lib/score-inference'
```

**Change 2 — Inference fallback** (inside `upsertMatch`, after `writeFinalState`):
After the match is written as finished, check if the last set is still null. If so, call `inferFinalScore()`. See the patch file for exact code.

**Change 3 — Batch reconciliation** (after the existing reconciliation loop):
Add `inferBatch()` call to catch older matches that slipped through.

**Change 4 — score_source tagging**:
- Add `score_source: 'api'` to all `writeFinalState()` set upserts
- Add `score_source: 'live'` to all live tracking set upserts

### Phase 4 — Wire into Railway Relay (`relay/index.js`)

Apply the 2 changes from `INTEGRATION_PATCH.js`:

**Change 1 — Helper functions**:
Copy the pure scoring functions into relay/index.js (since the relay can't import from the Next.js src/ tree).

**Change 2 — Finished event handler**:
In the Pusher event handler, when status changes to `finished`, call `tryInferFinalScore()` before unsubscribing.

### Phase 5 — Wire into Tournament Sync (`sync/route.ts`)

Apply the 2 changes from `INTEGRATION_PATCH.ts`:

**Change 1 — score_source: 'api'**: Add to all set upserts in `syncTournamentMatches()`.

**Change 2 — Skip condition**: Update to only skip matches where ALL sets have `score_source = 'api'`. This ensures inferred scores get overwritten with API-confirmed data on the next sync.

### Phase 6 — Test with real data

```bash
# 1. Trigger a tournament sync to confirm score_source tagging works
curl -H "Authorization: Bearer 30143014" \
  "https://padel-nacho.vercel.app/api/cron/sync?tournament=728"

# 2. Verify in Supabase:
# SELECT set_score, score_source FROM sets WHERE match_id = '<some-match>' ORDER BY set_number;

# 3. Wait for a live match to finish during the next tournament
# Check logs for "[score-inference]" entries

# 4. Verify no orphan sets were created:
# SELECT * FROM sets WHERE set_score IS NULL AND match_id IN (
#   SELECT id FROM matches WHERE status = 'finished'
# );
```

## Architecture diagram

```
                    ┌─────────────┐
                    │ padelapi.org│
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
    ┌───────▼───────┐ ┌───▼────┐ ┌───────▼───────┐
    │ Score Agent   │ │ Relay  │ │Tournament Sync│
    │ (2min cron)   │ │(always)│ │ (6h cron)     │
    └───────┬───────┘ └───┬────┘ └───────┬───────┘
            │              │              │
            ▼              ▼              ▼
    ┌─ upsertMatch ─┐  write to    ┌─ upsert all ──┐
    │ writeFinalState│  Supabase    │ matches + sets │
    │ score_src: api │  score_src:  │ score_src: api │
    └───────┬───────┘  live        └───────┬────────┘
            │                              │
    ┌───────▼───────┐                      │
    │ inferFinalScore│ ◄── NEW             │
    │ score_src:     │                     │
    │ inferred       │    API overwrites   │
    └───────┬───────┘    inferred ─────────┘
            │
    ┌───────▼───────┐
    │   Supabase    │
    │ sets table    │
    │ +score_source │
    └───────────────┘
```

## Priority system

| Score source | Written by | Priority | Overwritable? |
|---|---|---|---|
| `api` | writeFinalState, tournament sync | Highest | Never |
| `inferred` | inferFinalScore | Medium | Yes, by `api` |
| `live` | Live tracking during match | Lowest | Yes, by `api` or `inferred` |

## Safety guarantees

1. **Idempotent**: Running inference multiple times produces the same result
2. **Never creates rows**: Only UPDATEs existing set rows (prevents orphan sets)
3. **Never overwrites API data**: Checks `score_source !== 'api'` before writing
4. **Only on `finished`**: Never runs on live, scheduled, retired, walkover, bye, ended
5. **Validates scores**: Checks inferred score against padel rules before writing
6. **Auditable**: `score_source = 'inferred'` marks every inference for tracking
7. **Defensive**: Returns null and logs when data is insufficient — never guesses

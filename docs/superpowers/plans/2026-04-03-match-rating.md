# Match Rating Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rate finished matches 1-5 with a celebration animation, persisting ratings to DB for both logged-in and anonymous users, and displaying community averages.

**Architecture:** New `match_ratings` table with device_id (anonymous) and user_id (authenticated) tracking. API route handles upserts via service key. Hook dual-writes to localStorage (instant) and DB (background). Celebration burst animation is pure CSS. Anonymous ratings migrate to user on login.

**Tech Stack:** Next.js API routes, Supabase (Postgres + RLS), React hooks, CSS keyframe animations

**Spec:** `docs/superpowers/specs/2026-04-03-match-rating-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260403_match_ratings.sql` | Table, trigger, RLS, denormalized columns |
| Create | `src/app/api/match-rating/route.ts` | POST endpoint for rating upsert |
| Modify | `src/types/match.ts` | Add `avg_rating`, `rating_count` to Match interface |
| Modify | `src/hooks/useMatchRating.ts` | Dual-write (localStorage + API), device_id, community stats |
| Modify | `src/components/AuthProvider.tsx` | Rating migration on login |
| Modify | `src/app/match/[id]/page.tsx` | Move card above tabs, celebration burst animation |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260403_match_ratings.sql`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/20260403_match_ratings.sql`:

```sql
-- supabase/migrations/20260403_match_ratings.sql
-- Match ratings: per-user and per-device tracking with denormalized aggregates

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.match_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  device_id text,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT one_per_user UNIQUE NULLS NOT DISTINCT (match_id, user_id),
  CONSTRAINT one_per_device UNIQUE NULLS NOT DISTINCT (match_id, device_id),
  CONSTRAINT must_have_identity CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX idx_match_ratings_match ON public.match_ratings(match_id);

-- ── Denormalized columns on matches ──────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS avg_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS rating_count integer DEFAULT 0;

-- ── Trigger: recompute aggregates ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_match_rating_stats()
RETURNS trigger AS $$
DECLARE
  target_match_id uuid;
BEGIN
  target_match_id := COALESCE(NEW.match_id, OLD.match_id);
  UPDATE public.matches SET
    avg_rating = sub.avg,
    rating_count = sub.cnt
  FROM (
    SELECT
      ROUND(AVG(rating)::numeric, 1) AS avg,
      COUNT(*)::integer AS cnt
    FROM public.match_ratings
    WHERE match_id = target_match_id
  ) sub
  WHERE id = target_match_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_match_rating_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.match_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_match_rating_stats();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.match_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ratings"
  ON public.match_ratings FOR SELECT
  USING (true);

CREATE POLICY "Auth users can insert own ratings"
  ON public.match_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Auth users can update own ratings"
  ON public.match_ratings FOR UPDATE
  USING (auth.uid() = user_id);

-- Note: Anonymous inserts/updates go through the API route using service key
```

- [ ] **Step 2: Apply migration via Supabase dashboard**

Copy the SQL from `supabase/migrations/20260403_match_ratings.sql` and run it in the Supabase SQL editor. Verify:
- Table `match_ratings` exists with correct columns and constraints
- `matches` table has `avg_rating` and `rating_count` columns
- Trigger `trg_match_rating_stats` is active

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260403_match_ratings.sql
git commit -m "feat: add match_ratings table with trigger and RLS"
```

---

## Task 2: Match Type Update

**Files:**
- Modify: `src/types/match.ts:40-59`

- [ ] **Step 1: Add rating fields to Match interface**

In `src/types/match.ts`, add two fields to the `Match` interface after `viewer_count`:

```typescript
  viewer_count?: number
  avg_rating?: number | null
  rating_count?: number
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors (the match query already uses `*` so it fetches these columns automatically)

- [ ] **Step 3: Commit**

```bash
git add src/types/match.ts
git commit -m "feat: add avg_rating and rating_count to Match type"
```

---

## Task 3: API Route

**Files:**
- Create: `src/app/api/match-rating/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/match-rating/route.ts`:

```typescript
// src/app/api/match-rating/route.ts
// Upsert match ratings for authenticated and anonymous users.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.matchId || !body?.rating) {
    return NextResponse.json({ error: 'Missing matchId or rating' }, { status: 400 })
  }

  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  const matchId: string = body.matchId
  const deviceId: string | undefined = body.deviceId
  const supabase = createServerClient()

  // Check for authenticated user via Authorization header
  let userId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    userId = user?.id ?? null
  }

  if (!userId && !deviceId) {
    return NextResponse.json({ error: 'Must provide deviceId or auth token' }, { status: 400 })
  }

  // Upsert the rating
  if (userId) {
    // Authenticated: upsert by user_id, also clear any anonymous rating from same device
    const { error } = await supabase
      .from('match_ratings')
      .upsert(
        { match_id: matchId, user_id: userId, device_id: null, rating, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,user_id' }
      )
    if (error) {
      console.error('[match-rating] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
    }
    // Clean up anonymous rating for this device+match if it exists
    if (deviceId) {
      await supabase
        .from('match_ratings')
        .delete()
        .eq('match_id', matchId)
        .eq('device_id', deviceId)
        .is('user_id', null)
    }
  } else {
    // Anonymous: upsert by device_id
    const { error } = await supabase
      .from('match_ratings')
      .upsert(
        { match_id: matchId, device_id: deviceId, user_id: null, rating, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,device_id' }
      )
    if (error) {
      console.error('[match-rating] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
    }
  }

  // Return fresh aggregates (trigger has already updated them)
  const { data: match } = await supabase
    .from('matches')
    .select('avg_rating, rating_count')
    .eq('id', matchId)
    .single()

  return NextResponse.json({
    ok: true,
    avg_rating: match?.avg_rating ?? null,
    rating_count: match?.rating_count ?? 0,
  })
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/match-rating/route.ts
git commit -m "feat: add POST /api/match-rating endpoint"
```

---

## Task 4: Update useMatchRating Hook

**Files:**
- Modify: `src/hooks/useMatchRating.ts`

- [ ] **Step 1: Rewrite the hook with dual-write and device ID**

Replace the entire contents of `src/hooks/useMatchRating.ts`:

```typescript
'use client'

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const RATINGS_KEY = 'pn_match_ratings'
const DEVICE_ID_KEY = 'pn_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function readAllLocal(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RATINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeLocal(matchId: string, rating: number) {
  try {
    const all = readAllLocal()
    all[matchId] = rating
    localStorage.setItem(RATINGS_KEY, JSON.stringify(all))
  } catch {}
}

export interface RatingState {
  rating: number | null
  avgRating: number | null
  ratingCount: number
  setRating: (n: number) => void
}

export function useMatchRating(matchId: string, matchAvg?: number | null, matchCount?: number): RatingState {
  const [rating, setRatingState] = useState<number | null>(() => {
    try { return readAllLocal()[matchId] ?? null } catch { return null }
  })
  const [avgRating, setAvgRating] = useState<number | null>(matchAvg ?? null)
  const [ratingCount, setRatingCount] = useState<number>(matchCount ?? 0)

  // Sync if match-level stats change (e.g., after refetch)
  useEffect(() => {
    if (matchAvg !== undefined) setAvgRating(matchAvg ?? null)
    if (matchCount !== undefined) setRatingCount(matchCount ?? 0)
  }, [matchAvg, matchCount])

  const setRating = useCallback(async (n: number) => {
    // Optimistic local update
    setRatingState(n)
    writeLocal(matchId, n)

    // Background DB write
    try {
      const deviceId = getDeviceId()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      // Attach auth token if logged in
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const res = await fetch('/api/match-rating', {
        method: 'POST',
        headers,
        body: JSON.stringify({ matchId, rating: n, deviceId }),
      })

      if (res.ok) {
        const data = await res.json()
        setAvgRating(data.avg_rating ?? null)
        setRatingCount(data.rating_count ?? 0)
      }
    } catch (e) {
      console.error('[useMatchRating] API write failed:', e)
    }
  }, [matchId])

  return { rating, avgRating, ratingCount, setRating }
}

// Export for migration in AuthProvider
export { readAllLocal as readAllRatings, RATINGS_KEY, DEVICE_ID_KEY }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: may have type errors in `page.tsx` since hook signature changed — those will be fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMatchRating.ts
git commit -m "feat: dual-write useMatchRating with device ID and community stats"
```

---

## Task 5: Rating Migration on Login

**Files:**
- Modify: `src/components/AuthProvider.tsx`

- [ ] **Step 1: Add rating migration function**

In `src/components/AuthProvider.tsx`, add after the `migrateLocalBookmarks` function (after line 63):

```typescript
async function migrateLocalRatings(accessToken: string) {
  try {
    const { readAllRatings, RATINGS_KEY, DEVICE_ID_KEY } = await import('@/hooks/useMatchRating')
    const ratings = readAllRatings()
    const entries = Object.entries(ratings)
    if (!entries.length) return

    const deviceId = localStorage.getItem(DEVICE_ID_KEY)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    }

    const results = await Promise.allSettled(
      entries.map(([matchId, rating]) =>
        fetch('/api/match-rating', {
          method: 'POST',
          headers,
          body: JSON.stringify({ matchId, rating, deviceId }),
        })
      )
    )

    const allOk = results.every(r => r.status === 'fulfilled' && (r.value as Response).ok)
    if (allOk) {
      localStorage.removeItem(RATINGS_KEY)
      console.log(`[Auth] Migrated ${entries.length} ratings to Supabase`)
    }
  } catch (e) {
    console.error('[Auth] Rating migration failed:', e)
  }
}
```

- [ ] **Step 2: Call migration on SIGNED_IN**

In the `onAuthStateChange` callback, after the `migrateLocalBookmarks` call (around line 108), add:

```typescript
          if (event === 'SIGNED_IN') {
            await migrateLocalBookmarks(s.user.id)
            if (s.access_token) {
              await migrateLocalRatings(s.access_token)
            }
          }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "feat: migrate anonymous ratings to user on login"
```

---

## Task 6: UI — Move Rating Card & Celebration Burst

**Files:**
- Modify: `src/app/match/[id]/page.tsx`

This task modifies the match detail page in three parts:
1. Update hook usage (new signature)
2. Move rating card from inside Score Recap tab to above the tab bar
3. Replace `MatchRatingCard` component with celebration burst animation

- [ ] **Step 1: Update hook import and usage**

Change the import at the top of the file (line 14):

```typescript
import { useMatchRating } from '@/hooks/useMatchRating'
```

No change needed — the import stays the same.

Update the hook call (around line 126). Find the line:

```typescript
  const { rating, setRating } = useMatchRating(id)
```

Replace with:

```typescript
  const { rating, setRating, avgRating, ratingCount } = useMatchRating(
    id,
    (match as any)?.avg_rating ?? null,
    (match as any)?.rating_count ?? 0
  )
```

Note: `match` may be null during initial load, so use optional chaining. The hook handles `undefined` gracefully.

- [ ] **Step 2: Move rating card above tab bar**

Find the rating card inside the Score Recap tab content (around line 662):

```typescript
            {subTab === 'recap' && isFinished && (
              <>
                <MatchRatingCard rating={rating} setRating={setRating} />
                <FinishedStatsSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
              </>
            )}
```

Remove the `<MatchRatingCard>` line so it becomes:

```typescript
            {subTab === 'recap' && isFinished && (
              <FinishedStatsSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
            )}
```

Then, just **above** the tab bar div (the `<div style={{ display: 'flex', borderBottom:...` around line 652), add:

```typescript
          {isFinished && (
            <MatchRatingCard rating={rating} setRating={setRating} avgRating={avgRating} ratingCount={ratingCount} />
          )}
```

- [ ] **Step 3: Rewrite MatchRatingCard with celebration burst**

Replace the entire `MatchRatingCard` function (starting around line 942) with:

```typescript
const REACTION_LABELS: Record<number, string> = { 1: 'Boring', 2: 'Meh', 3: 'Decent', 4: 'Great match!', 5: 'Epic' }

function MatchRatingCard({ rating, setRating, avgRating, ratingCount }: {
  rating: number | null
  setRating: (n: number) => void
  avgRating: number | null
  ratingCount: number
}) {
  const [justRated, setJustRated] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(rating != null)
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string }[]>([])

  const handleRate = (n: number) => {
    setRating(n)
    setJustRated(n)

    // Generate particles
    const colors = [GREEN, ORANGE, GREEN, '#fff', ORANGE, GREEN, ORANGE, GREEN]
    const newParticles = colors.map((color, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 80,
      y: (Math.random() - 0.5) * 80,
      color,
    }))
    setParticles(newParticles)

    // Collapse after 2s
    setTimeout(() => {
      setCollapsed(true)
      setJustRated(null)
      setParticles([])
    }, 2000)
  }

  // Already rated on a previous visit — show compact immediately
  if (collapsed || (rating != null && justRated == null)) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#000' }}>{rating}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(126,211,33,0.7)' }}>
            {REACTION_LABELS[rating!]}
          </span>
          {ratingCount >= 10 && avgRating != null && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: MUTED }}>avg {avgRating}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Celebration burst state (just tapped)
  if (justRated != null) {
    return (
      <div style={{ padding: '20px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <style>{`
          @keyframes pn-burst {
            0% { transform: translate(0,0) scale(1); opacity: 1; }
            100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
          }
          @keyframes pn-scale-up {
            0% { transform: scale(1); }
            50% { transform: scale(1.4); }
            100% { transform: scale(1.3); }
          }
          @keyframes pn-fade-in {
            0% { opacity: 0; transform: translateY(6px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {/* Particles */}
          {particles.map(p => (
            <div key={p.id} style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 6, height: 6, borderRadius: '50%', background: p.color,
              // @ts-expect-error CSS custom properties
              '--tx': `${p.x}px`, '--ty': `${p.y}px`,
              animation: 'pn-burst 0.6s ease-out forwards',
              pointerEvents: 'none',
            } as React.CSSProperties} />
          ))}
          {/* Badge */}
          <div style={{
            width: 48, height: 48, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pn-scale-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#000' }}>{justRated}</span>
          </div>
        </div>
        <div style={{
          fontSize: 14, fontWeight: 900, color: GREEN, marginTop: 10,
          animation: 'pn-fade-in 0.3s ease 0.15s both',
        }}>
          {REACTION_LABELS[justRated]}
        </div>
      </div>
    )
  }

  // Unrated state — show picker
  return (
    <div style={{ padding: '16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', textAlign: 'center', marginBottom: 14 }}>
        Rate this match
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>Boring</span>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => handleRate(n)} style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: MUTED }}>{n}</span>
          </button>
        ))}
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>Epic</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Visual verification**

Open `http://localhost:3002/match/<finished-match-id>` and verify:
1. Rating card appears below the scores, above the tab bar
2. Tapping a number triggers celebration burst (scale + particles + reaction word)
3. After 2s, collapses to compact form
4. Refreshing the page shows compact form immediately
5. Community average shows only when `rating_count >= 10`

- [ ] **Step 6: Commit**

```bash
git add src/app/match/[id]/page.tsx
git commit -m "feat: celebration burst rating UI above tabs with community avg"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database migration (table + trigger + RLS) | `supabase/migrations/20260403_match_ratings.sql` |
| 2 | Add rating fields to Match type | `src/types/match.ts` |
| 3 | API route for rating upsert | `src/app/api/match-rating/route.ts` |
| 4 | Dual-write hook with device ID | `src/hooks/useMatchRating.ts` |
| 5 | Rating migration on login | `src/components/AuthProvider.tsx` |
| 6 | UI: move card + celebration burst | `src/app/match/[id]/page.tsx` |

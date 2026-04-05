# Favorites & Following System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Favorites/Following system with a new "Following" bottom nav tab, letting users bookmark matches and follow players, tournaments, and news sources.

**Architecture:** Extend the existing `user_bookmarks` table and dual-mode localStorage/Supabase pattern. New `useFollowing` hook replaces `useBookmarks`. New `/v3/following` page with Smart Sections layout (horizontal scrolling sections per entity type). Follow/bookmark actions added inline across match cards, player profiles, tournament pages, rankings, and feed.

**Tech Stack:** React 19, Next.js 16, Supabase (PostgreSQL + RLS), localStorage, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-05-favorites-system-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260405_extend_bookmarks.sql` | Create | Extend CHECK constraint for tournament/news_source types |
| `src/hooks/useFollowing.ts` | Create | Unified follow/bookmark hook (replaces useBookmarks) |
| `src/hooks/useBookmarks.ts` | Modify | Add deprecation notice, re-export from useFollowing for compat |
| `src/components/AuthProvider.tsx` | Modify | Update migration to handle new follow types |
| `src/app/v3/components/BottomNavV3.tsx` | Modify | Add 4th "Following" tab |
| `src/app/v3/following/page.tsx` | Create | Following dashboard page (Smart Sections) |
| `src/app/v3/following/layout.tsx` | Create | Layout wrapper for following page |
| `src/components/FollowButton.tsx` | Create | Reusable follow/bookmark button component |
| `src/app/v3/page.tsx` | Modify | Add bookmark star to UpcomingMatchCard |
| `src/app/v3/scores/page.tsx` | Modify | Add bookmark star to match rows |
| `src/app/match/[id]/page.tsx` | Modify | Add bookmark star + player follow hearts |
| `src/app/player/[id]/page.tsx` | Modify | Add follow button to player header |
| `src/app/v3/ranking/page.tsx` | Modify | Add follow heart to ranking rows |
| `src/app/v3/tournaments/[id]/page.tsx` | Modify | Add follow button to tournament header |
| `src/app/v3/feed/page.tsx` | Modify | Add follow source link to article cards |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260405_extend_bookmarks.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Extend user_bookmarks to support tournament and news_source types
ALTER TABLE public.user_bookmarks
  DROP CONSTRAINT IF EXISTS user_bookmarks_bookmark_type_check;

ALTER TABLE public.user_bookmarks
  ADD CONSTRAINT user_bookmarks_bookmark_type_check
    CHECK (bookmark_type IN ('match', 'player', 'tournament', 'news_source'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260405_extend_bookmarks.sql
git commit -m "feat: extend user_bookmarks for tournament and news_source types"
```

> **Note:** Apply this migration via Supabase dashboard before testing authenticated flows. Anonymous localStorage flows work without the migration.

---

### Task 2: `useFollowing` Hook

**Files:**
- Create: `src/hooks/useFollowing.ts`
- Modify: `src/hooks/useBookmarks.ts`

- [ ] **Step 1: Create the `useFollowing` hook**

Create `src/hooks/useFollowing.ts`:

```typescript
'use client'
// src/hooks/useFollowing.ts
// Unified follow/bookmark hook for matches, players, tournaments, news sources.
// Dual-mode: localStorage (anonymous) + Supabase (authenticated).
// Migrates old pn_bookmarked_matches key on first load.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

export type FollowType = 'match' | 'player' | 'tournament' | 'news_source'

const STORAGE_KEY = 'pn_following'
const OLD_BOOKMARKS_KEY = 'pn_bookmarked_matches'

// Supabase-compatible types (news_source uses localStorage only)
const SUPABASE_TYPES: FollowType[] = ['match', 'player', 'tournament']

interface FollowingStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
}

function emptyStore(): FollowingStore {
  return { matches: [], players: [], tournaments: [], news_sources: [] }
}

function storeKey(type: FollowType): keyof FollowingStore {
  const map: Record<FollowType, keyof FollowingStore> = {
    match: 'matches',
    player: 'players',
    tournament: 'tournaments',
    news_source: 'news_sources',
  }
  return map[type]
}

function readLocalStorage(): FollowingStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as FollowingStore

    // Migrate old bookmarks key if present
    const oldRaw = localStorage.getItem(OLD_BOOKMARKS_KEY)
    if (oldRaw) {
      const oldIds = JSON.parse(oldRaw) as string[]
      const store = emptyStore()
      store.matches = oldIds
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      localStorage.removeItem(OLD_BOOKMARKS_KEY)
      return store
    }

    return emptyStore()
  } catch {
    return emptyStore()
  }
}

function writeLocalStorage(store: FollowingStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch { /* quota exceeded — silently fail */ }
}

export function useFollowing() {
  const { user } = useAuth()
  const [store, setStore] = useState<FollowingStore>(emptyStore())
  const [loaded, setLoaded] = useState(false)

  // Load on mount or auth change
  useEffect(() => {
    if (user) {
      // Fetch all Supabase bookmarks for this user
      supabase
        .from('user_bookmarks')
        .select('bookmark_type, target_id')
        .eq('user_id', user.id)
        .then(({ data }) => {
          const s = emptyStore()
          // Also load news_sources from localStorage (not in Supabase)
          const local = readLocalStorage()
          s.news_sources = local.news_sources

          for (const row of data ?? []) {
            const key = storeKey(row.bookmark_type as FollowType)
            if (key && key !== 'news_sources') {
              s[key].push(row.target_id)
            }
          }
          setStore(s)
          setLoaded(true)
        })
    } else {
      setStore(readLocalStorage())
      setLoaded(true)
    }
  }, [user])

  const isFollowing = useCallback(
    (type: FollowType, targetId: string) => {
      return store[storeKey(type)].includes(targetId)
    },
    [store],
  )

  const toggle = useCallback(
    async (type: FollowType, targetId: string) => {
      const key = storeKey(type)
      const isCurrently = store[key].includes(targetId)

      // Optimistic update
      setStore(prev => {
        const next = { ...prev, [key]: isCurrently
          ? prev[key].filter(id => id !== targetId)
          : [...prev[key], targetId]
        }
        if (!user) writeLocalStorage(next)
        return next
      })

      // Persist to Supabase for supported types
      if (user && SUPABASE_TYPES.includes(type)) {
        if (isCurrently) {
          await supabase
            .from('user_bookmarks')
            .delete()
            .eq('user_id', user.id)
            .eq('bookmark_type', type)
            .eq('target_id', targetId)
        } else {
          await supabase
            .from('user_bookmarks')
            .insert({
              user_id: user.id,
              bookmark_type: type,
              target_id: targetId,
            })
        }
      }

      // news_source: always persist to localStorage even when authenticated
      if (type === 'news_source') {
        setStore(prev => {
          writeLocalStorage(prev)
          return prev
        })
      }
    },
    [user, store],
  )

  const getFollowed = useCallback(
    (type: FollowType) => store[storeKey(type)],
    [store],
  )

  const counts = useMemo(() => ({
    match: store.matches.length,
    player: store.players.length,
    tournament: store.tournaments.length,
    news_source: store.news_sources.length,
  }), [store])

  return { isFollowing, toggle, getFollowed, counts, loaded }
}
```

- [ ] **Step 2: Update `useBookmarks` to re-export from `useFollowing`**

Replace the contents of `src/hooks/useBookmarks.ts` with a thin wrapper:

```typescript
'use client'
// src/hooks/useBookmarks.ts
// DEPRECATED: Use useFollowing instead.
// This wrapper maintains backwards compatibility for existing consumers.

import { useCallback } from 'react'
import { useFollowing } from './useFollowing'

export function useBookmarks() {
  const { isFollowing, toggle, getFollowed, loaded } = useFollowing()

  const isBookmarked = useCallback(
    (matchId: string) => isFollowing('match', matchId),
    [isFollowing],
  )

  const toggleBookmark = useCallback(
    (matchId: string) => toggle('match', matchId),
    [toggle],
  )

  const bookmarked = new Set(getFollowed('match'))

  return { isBookmarked, toggle: toggleBookmark, bookmarked, loaded }
}
```

- [ ] **Step 3: Verify the app still compiles**

Run: `npm run build` (or check dev server for errors)
Expected: No compilation errors. Existing bookmark consumers work unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFollowing.ts src/hooks/useBookmarks.ts
git commit -m "feat: add useFollowing hook, deprecate useBookmarks"
```

---

### Task 3: Update Auth Migration

**Files:**
- Modify: `src/components/AuthProvider.tsx` (lines 39-63)

- [ ] **Step 1: Update `migrateLocalBookmarks` to handle all follow types**

In `src/components/AuthProvider.tsx`, find the `migrateLocalBookmarks` function (around line 39) and replace it with:

```typescript
async function migrateLocalBookmarks(userId: string) {
  try {
    // Migrate old single-key bookmarks
    const oldRaw = localStorage.getItem('pn_bookmarked_matches')
    if (oldRaw) {
      const ids = JSON.parse(oldRaw) as string[]
      if (ids.length > 0) {
        const rows = ids.map(id => ({
          user_id: userId,
          bookmark_type: 'match' as const,
          target_id: id,
        }))
        await supabase
          .from('user_bookmarks')
          .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
      }
      localStorage.removeItem('pn_bookmarked_matches')
    }

    // Migrate new multi-type follows
    const followRaw = localStorage.getItem('pn_following')
    if (followRaw) {
      const store = JSON.parse(followRaw) as {
        matches?: string[]; players?: string[]; tournaments?: string[]; news_sources?: string[]
      }
      const rows: { user_id: string; bookmark_type: string; target_id: string }[] = []

      for (const id of store.matches ?? []) {
        rows.push({ user_id: userId, bookmark_type: 'match', target_id: id })
      }
      for (const id of store.players ?? []) {
        rows.push({ user_id: userId, bookmark_type: 'player', target_id: id })
      }
      for (const id of store.tournaments ?? []) {
        rows.push({ user_id: userId, bookmark_type: 'tournament', target_id: id })
      }
      // news_sources stay in localStorage (no UUID target_id)

      if (rows.length > 0) {
        await supabase
          .from('user_bookmarks')
          .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
      }

      // Keep only news_sources in localStorage after migration
      const newsOnly = { matches: [], players: [], tournaments: [], news_sources: store.news_sources ?? [] }
      localStorage.setItem('pn_following', JSON.stringify(newsOnly))
    }
  } catch (err) {
    console.warn('[Auth] Follow migration failed:', err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "feat: update auth migration for multi-type follows"
```

---

### Task 4: Reusable `FollowButton` Component

**Files:**
- Create: `src/components/FollowButton.tsx`

- [ ] **Step 1: Create the FollowButton component**

Create `src/components/FollowButton.tsx`:

```typescript
'use client'
// src/components/FollowButton.tsx
// Reusable follow/bookmark button with two variants:
// - "star" for match bookmarks (small inline icon)
// - "follow" for players/tournaments (button with text)
// - "heart" for player follows (small inline icon)

import { useFollowing, FollowType } from '@/hooks/useFollowing'

const GOLD = '#F5A623'
const GREEN = '#7ED321'

interface FollowButtonProps {
  type: FollowType
  targetId: string
  variant: 'star' | 'follow' | 'heart'
  size?: number
  style?: React.CSSProperties
}

export default function FollowButton({ type, targetId, variant, size = 16, style }: FollowButtonProps) {
  const { isFollowing, toggle } = useFollowing()
  const active = isFollowing(type, targetId)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle(type, targetId)
  }

  if (variant === 'star') {
    return (
      <button
        onClick={handleClick}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.2s ease',
          transform: active ? 'scale(1)' : 'scale(1)',
          ...style,
        }}
        aria-label={active ? 'Remove bookmark' : 'Bookmark match'}
      >
        <svg width={size} height={size} viewBox="0 0 24 24"
          fill={active ? GOLD : 'none'}
          stroke={active ? GOLD : '#6B7280'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'fill 0.2s, stroke 0.2s' }}
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>
    )
  }

  if (variant === 'heart') {
    return (
      <button
        onClick={handleClick}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...style,
        }}
        aria-label={active ? 'Unfollow player' : 'Follow player'}
      >
        <svg width={size} height={size} viewBox="0 0 24 24"
          fill={active ? GREEN : 'none'}
          stroke={active ? GREEN : '#6B7280'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'fill 0.2s, stroke 0.2s' }}
        >
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
      </button>
    )
  }

  // variant === 'follow'
  return (
    <button
      onClick={handleClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 12px',
        background: active ? 'rgba(126,211,33,0.15)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? 'rgba(126,211,33,0.3)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 6,
        color: active ? GREEN : '#aaa',
        fontSize: 11, fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        ...style,
      }}
      aria-label={active ? `Unfollow ${type}` : `Follow ${type}`}
    >
      {active ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Following
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Follow
        </>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/FollowButton.tsx
git commit -m "feat: add reusable FollowButton component (star, heart, follow variants)"
```

---

### Task 5: Bottom Nav — Add Following Tab

**Files:**
- Modify: `src/app/v3/components/BottomNavV3.tsx` (lines 54-58, 65-69)

- [ ] **Step 1: Add FollowingIcon component**

After the existing icon components (around line 45), add:

```typescript
function FollowingIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}
```

- [ ] **Step 2: Update TABS array to include Following**

Replace the TABS array (lines 54-58) with:

```typescript
const TABS = [
  { key: 'scores',    label: 'Matches',   href: '/v3/scores',     icon: ScoresIcon },
  { key: 'home',      label: 'Home',      href: '/v3',            icon: null },
  { key: 'following', label: 'Following', href: '/v3/following',  icon: FollowingIcon },
  { key: 'feed',      label: 'Feed',      href: '/v3/feed',       icon: FeedIcon },
] as const
```

- [ ] **Step 3: Update active tab detection**

Replace the activeKey logic (lines 65-69) with:

```typescript
  const activeKey =
    pathname === '/v3' || pathname === '/v3/' ? 'home' :
    pathname.startsWith('/v3/scores') ? 'scores' :
    pathname.startsWith('/v3/following') ? 'following' :
    pathname.startsWith('/v3/feed') ? 'feed' :
    'home'
```

- [ ] **Step 4: Adjust tab padding for 4 tabs**

In the tab Link style (around line 121), reduce the horizontal padding:

Change `padding: '6px 24px'` to `padding: '6px 16px'`

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/v3` and confirm:
- 4 tabs visible: Matches, Home, Following, Feed
- Following tab shows star icon
- Tapping Following navigates to `/v3/following` (will 404 until Task 6)
- All tabs fit without overflow

- [ ] **Step 6: Commit**

```bash
git add src/app/v3/components/BottomNavV3.tsx
git commit -m "feat: add Following tab to bottom nav (4 tabs)"
```

---

### Task 6: Following Page — Layout & Smart Sections

**Files:**
- Create: `src/app/v3/following/layout.tsx`
- Create: `src/app/v3/following/page.tsx`

- [ ] **Step 1: Create the layout file**

Create `src/app/v3/following/layout.tsx`:

```typescript
import BottomNavV3 from '../components/BottomNavV3'

export default function FollowingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomNavV3 />
    </>
  )
}
```

- [ ] **Step 2: Create the Following page**

Create `src/app/v3/following/page.tsx`. This is the largest file — Smart Sections layout with Live & Upcoming, Players, Tournaments, and News Sources sections.

```typescript
'use client'
// src/app/v3/following/page.tsx
// Following dashboard — Smart Sections layout.
// Shows horizontal scrolling sections for each entity type.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useFollowing } from '@/hooks/useFollowing'
import { supabase } from '@/lib/supabase'
import FollowButton from '@/components/FollowButton'
import SearchOverlay from '../components/SearchOverlay'

// ── Types ──────────────────────────────────────────────────────
interface FollowedMatch {
  id: string
  status: string
  scheduled_at: string | null
  round: string | null
  category: string | null
  pair1_player1: { id: string; name: string; country: string | null } | null
  pair1_player2: { id: string; name: string; country: string | null } | null
  pair2_player1: { id: string; name: string; country: string | null } | null
  pair2_player2: { id: string; name: string; country: string | null } | null
  tournament: { id: string; name: string } | null
  sets: { set_number: number; pair1_games: number; pair2_games: number; is_current: boolean }[]
}

interface FollowedPlayer {
  id: string
  name: string
  country: string | null
  avatar_url: string | null
  ranking: number | null
  category: string | null
}

interface FollowedTournament {
  id: string
  name: string
  country: string | null
  level: string | null
  starts_at: string
  ends_at: string
}

// ── Colors ─────────────────────────────────────────────────────
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const BG_CARD = 'rgba(255,255,255,0.03)'
const LIVE_RED = '#FF4655'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Helpers ────────────────────────────────────────────────────
function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function isLive(t: FollowedTournament): boolean {
  const now = Date.now()
  return new Date(t.starts_at).getTime() <= now && new Date(t.ends_at).getTime() >= now
}

function tournamentStatus(t: FollowedTournament): { label: string; color: string } {
  if (isLive(t)) return { label: 'Live', color: LIVE_RED }
  const days = Math.ceil((new Date(t.starts_at).getTime() - Date.now()) / 86400000)
  if (days <= 0) return { label: 'Today', color: GREEN }
  if (days === 1) return { label: 'Tomorrow', color: GREEN }
  return { label: `Starts ${new Date(t.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, color: MUTED }
}

// ── Section Header ─────────────────────────────────────────────
function SectionHeader({ title, action, href, onAction }: {
  title: string; action?: string; href?: string; onAction?: () => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 6px' }}>
      <span style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
        display: 'inline-block', padding: '4px 10px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: '#fff',
      }}>{title}</span>
      {action && href && (
        <Link href={href} style={{ fontSize: 11, fontWeight: 700, color: GREEN, textDecoration: 'none' }}>
          {action}&rsaquo;
        </Link>
      )}
      {action && onAction && (
        <button onClick={onAction} style={{ fontSize: 11, fontWeight: 700, color: GREEN, background: 'none', border: 'none', cursor: 'pointer' }}>
          {action}
        </button>
      )}
    </div>
  )
}

// ── Scroll Row ─────────────────────────────────────────────────
function ScrollRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 16px', overflowX: 'auto',
      scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none', scrollbarWidth: 'none',
    }}>
      {children}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────
export default function FollowingPage() {
  const { getFollowed, counts, loaded } = useFollowing()
  const [matches, setMatches] = useState<FollowedMatch[]>([])
  const [players, setPlayers] = useState<FollowedPlayer[]>([])
  const [tournaments, setTournaments] = useState<FollowedTournament[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  const followedPlayerIds = getFollowed('player')
  const followedTournamentIds = getFollowed('tournament')
  const bookmarkedMatchIds = getFollowed('match')

  // Fetch followed entities from Supabase
  useEffect(() => {
    if (!loaded) return

    // Fetch matches: bookmarked + matches involving followed players/tournaments
    const fetchMatches = async () => {
      // Get bookmarked matches
      const matchIds = bookmarkedMatchIds
      // Get matches from followed players and tournaments
      let query = supabase
        .from('matches')
        .select(`
          id, status, scheduled_at, round, category,
          pair1_player1:players!pair1_player1_id(id, name, country),
          pair1_player2:players!pair1_player2_id(id, name, country),
          pair2_player1:players!pair2_player1_id(id, name, country),
          pair2_player2:players!pair2_player2_id(id, name, country),
          tournament:tournaments(id, name),
          sets(set_number, pair1_games, pair2_games, is_current)
        `)
        .in('status', ['live', 'scheduled'])
        .order('scheduled_at', { ascending: true })
        .limit(20)

      const { data } = await query
      if (!data) return

      // Filter to relevant matches
      const relevant = (data as unknown as FollowedMatch[]).filter(m => {
        if (matchIds.includes(m.id)) return true
        const playerIds = [m.pair1_player1?.id, m.pair1_player2?.id, m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean)
        if (playerIds.some(pid => followedPlayerIds.includes(pid!))) return true
        if (m.tournament && followedTournamentIds.includes(m.tournament.id)) return true
        return false
      })
      setMatches(relevant)
    }

    // Fetch followed players
    const fetchPlayers = async () => {
      if (followedPlayerIds.length === 0) { setPlayers([]); return }
      const { data } = await supabase
        .from('players')
        .select('id, name, country, avatar_url, ranking, category')
        .in('id', followedPlayerIds)
        .order('ranking', { ascending: true })
      setPlayers((data ?? []) as FollowedPlayer[])
    }

    // Fetch followed tournaments
    const fetchTournaments = async () => {
      if (followedTournamentIds.length === 0) { setTournaments([]); return }
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, country, level, starts_at, ends_at')
        .in('id', followedTournamentIds)
        .order('starts_at', { ascending: true })
      setTournaments((data ?? []) as FollowedTournament[])
    }

    fetchMatches()
    fetchPlayers()
    fetchTournaments()
  }, [loaded, followedPlayerIds.length, followedTournamentIds.length, bookmarkedMatchIds.length])

  const totalFollows = counts.match + counts.player + counts.tournament + counts.news_source

  if (!loaded) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: MUTED }}>Loading...</div>
  }

  // Empty state
  if (totalFollows === 0) {
    return (
      <div style={{ padding: '16px 16px 100px' }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4A0D0D 0%, #5C1212 50%, #6B1A1A 100%)',
          borderBottom: '1px solid rgba(255,69,85,0.3)',
          padding: '14px 16px', display: 'flex', alignItems: 'center',
        }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>Following</span>
        </div>

        <div style={{ textAlign: 'center', padding: '60px 30px', color: MUTED }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 16, opacity: 0.5 }}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Follow players and tournaments</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 24 }}>
            Bookmark matches to track them here.<br />
            Follow players to see all their upcoming games.
          </div>
          <Link href="/v3/ranking" style={{
            display: 'inline-block', padding: '10px 24px',
            background: GREEN, color: '#000', fontWeight: 700, fontSize: 13,
            borderRadius: 6, textDecoration: 'none',
          }}>
            Browse Players
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0 0 100px' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #4A0D0D 0%, #5C1212 50%, #6B1A1A 100%)',
        borderBottom: '1px solid rgba(255,69,85,0.3)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 18, fontWeight: 800 }}>Following</span>
        <button onClick={() => setSearchOpen(true)} style={{
          fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer',
        }}>+ Add</button>
      </div>

      {/* ── Live & Upcoming ── */}
      {matches.length > 0 && (
        <>
          <SectionHeader title="Live & Upcoming" action="All" href="/v3/scores" />
          <ScrollRow>
            {matches.map(m => {
              const isMatchLive = m.status === 'live'
              const genderColor = m.category === 'women' ? WOMEN_PURPLE : m.category === 'men' ? MEN_BLUE : null
              const time = m.scheduled_at
                ? new Date(m.scheduled_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
                : ''
              const currentSet = m.sets?.find(s => s.is_current)

              return (
                <Link key={m.id} href={`/match/${m.id}`} style={{ textDecoration: 'none', color: 'inherit', scrollSnapAlign: 'start' }}>
                  <div style={{
                    flexShrink: 0, width: 200, padding: 10, background: BG_CARD,
                    border: `1px solid ${BORDER}`, borderRadius: 8,
                    borderLeft: `3px solid ${isMatchLive ? LIVE_RED : genderColor ?? GREEN}`,
                  }}>
                    <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{m.tournament?.name ?? ''} {m.round ? `\u2022 ${m.round}` : ''}</span>
                      <FollowButton type="match" targetId={m.id} variant="star" size={12} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, margin: '1px 0' }}>{m.pair1_player1?.name ?? 'TBD'} / {m.pair1_player2?.name ?? 'TBD'}</div>
                    <div style={{ fontSize: 9, color: MUTED }}>vs</div>
                    <div style={{ fontSize: 11, fontWeight: 600, margin: '1px 0' }}>{m.pair2_player1?.name ?? 'TBD'} / {m.pair2_player2?.name ?? 'TBD'}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, marginTop: 4, color: isMatchLive ? LIVE_RED : GREEN }}>
                      {isMatchLive
                        ? `LIVE \u2022 ${m.sets?.map(s => `${s.pair1_games}-${s.pair2_games}`).join(' ')}`
                        : time || 'TBC'
                      }
                    </div>
                  </div>
                </Link>
              )
            })}
          </ScrollRow>
        </>
      )}

      {/* ── Players ── */}
      <SectionHeader title="Players" action="See All" href="/v3/ranking" />
      <ScrollRow>
        {players.map(p => (
          <Link key={p.id} href={`/player/${p.id}`} style={{ textDecoration: 'none', color: 'inherit', scrollSnapAlign: 'start' }}>
            <div style={{
              flexShrink: 0, width: 110, padding: 10, background: BG_CARD,
              border: `1px solid ${BORDER}`, borderRadius: 8, textAlign: 'center',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%', margin: '0 auto 6px',
                background: p.avatar_url ? `url(${p.avatar_url}) center/cover` : '#222',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: GREEN,
                border: `2px solid ${p.category === 'women' ? WOMEN_PURPLE : MEN_BLUE}`,
              }}>
                {!p.avatar_url && initials(p.name)}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name.split(' ').pop()}</div>
              <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>
                {p.ranking ? `#${p.ranking}` : ''}{p.country ? ` \u2022 ${p.country}` : ''}
              </div>
            </div>
          </Link>
        ))}
        {/* Add player card */}
        <div
          onClick={() => setSearchOpen(true)}
          style={{
            flexShrink: 0, width: 110, padding: 10, background: 'transparent',
            border: '1px dashed rgba(126,211,33,0.3)', borderRadius: 8, textAlign: 'center',
            cursor: 'pointer', scrollSnapAlign: 'start',
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: '50%', margin: '0 auto 6px',
            background: 'transparent', border: '1px dashed rgba(126,211,33,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: GREEN,
          }}>+</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: GREEN }}>Add Player</div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>Search</div>
        </div>
      </ScrollRow>

      {/* ── Tournaments ── */}
      {tournaments.length > 0 && (
        <>
          <SectionHeader title="Tournaments" action="See All" href="/v3/scores" />
          <ScrollRow>
            {tournaments.map(t => {
              const status = tournamentStatus(t)
              return (
                <Link key={t.id} href={`/v3/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', scrollSnapAlign: 'start' }}>
                  <div style={{
                    flexShrink: 0, width: 140, padding: 10, background: BG_CARD,
                    border: `1px solid ${BORDER}`, borderRadius: 8, textAlign: 'center',
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, margin: '0 auto 6px',
                      background: 'rgba(126,211,33,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20,
                    }}>&#127942;</div>
                    <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    <div style={{ fontSize: 9, color: status.color, marginTop: 2, fontWeight: 600 }}>{status.label}</div>
                  </div>
                </Link>
              )
            })}
          </ScrollRow>
        </>
      )}

      {/* ── News Sources ── */}
      {counts.news_source > 0 && (
        <>
          <SectionHeader title="News Sources" action="Manage" onAction={() => {/* future: open manage sheet */}} />
          <ScrollRow>
            {getFollowed('news_source').map(source => (
              <div key={source} style={{
                flexShrink: 0, width: 100, padding: 10, background: BG_CARD,
                border: `1px solid ${BORDER}`, borderRadius: 8, textAlign: 'center',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', margin: '0 auto 6px',
                  background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff',
                }}>{source.slice(0, 2).toUpperCase()}</div>
                <div style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source}</div>
              </div>
            ))}
          </ScrollRow>
        </>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:3000/v3/following` and confirm:
- Page loads without errors
- Empty state shows if no follows exist
- Star icon active in bottom nav
- Header matches app style

- [ ] **Step 4: Commit**

```bash
git add src/app/v3/following/layout.tsx src/app/v3/following/page.tsx
git commit -m "feat: add Following page with Smart Sections layout"
```

---

### Task 7: Add Bookmark Star to Match Cards

**Files:**
- Modify: `src/app/v3/page.tsx` (UpcomingMatchCard, around line 372)
- Modify: `src/app/v3/scores/page.tsx` (V3MatchRow)

- [ ] **Step 1: Add bookmark star to UpcomingMatchCard**

In `src/app/v3/page.tsx`, add the import at the top (after existing imports):

```typescript
import FollowButton from '@/components/FollowButton'
```

Then in the `UpcomingMatchCard` component, find the tournament/round badges row (the `<div>` with `justifyContent: 'space-between'` around line 392) and replace the empty `<span />` placeholder:

Replace:
```typescript
        <span />
```

With:
```typescript
        <FollowButton type="match" targetId={match.id} variant="star" size={14} />
```

- [ ] **Step 2: Add bookmark star to V3MatchRow on scores page**

In `src/app/v3/scores/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

Then in the `V3MatchRow` component, add a star button at the end of the match row (after the scores section, before the closing `</div>` of the root element). Find the appropriate location within the row and add:

```typescript
<FollowButton type="match" targetId={match.id} variant="star" size={14} style={{ position: 'absolute', top: 8, right: 8 }} />
```

- [ ] **Step 3: Verify in browser**

- Home page: UpcomingMatchCards show a star icon in the top-right of the badges row
- Scores page: Match rows show a star icon
- Tapping star toggles gold fill
- Starred matches appear in Following page Live & Upcoming section

- [ ] **Step 4: Commit**

```bash
git add src/app/v3/page.tsx src/app/v3/scores/page.tsx
git commit -m "feat: add bookmark star to match cards (home + scores pages)"
```

---

### Task 8: Add Follow to Player Profile & Rankings

**Files:**
- Modify: `src/app/player/[id]/page.tsx` (player header, around lines 175-215)
- Modify: `src/app/v3/ranking/page.tsx` (PlayerRow, around lines 148-213)

- [ ] **Step 1: Add follow button to player profile header**

In `src/app/player/[id]/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

Find the player hero section (around line 175-215, after the name/category badges area). Add the FollowButton after the name section:

```typescript
<FollowButton type="player" targetId={player.id} variant="follow" style={{ marginTop: 8 }} />
```

- [ ] **Step 2: Add follow heart to ranking rows**

In `src/app/v3/ranking/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

In the `PlayerRow` component, add a heart icon after the points section (right edge). Find the points display area (around line 203-210) and add after it:

```typescript
<FollowButton type="player" targetId={player.id} variant="heart" size={14} style={{ marginLeft: 8 }} />
```

- [ ] **Step 3: Verify in browser**

- Player profile (`/player/[id]`): "Follow" button visible below name, toggles to "Following"
- Rankings page: Heart icon on each row, toggles green fill
- Followed players appear in Following page Players section

- [ ] **Step 4: Commit**

```bash
git add src/app/player/[id]/page.tsx src/app/v3/ranking/page.tsx
git commit -m "feat: add follow button to player profiles and ranking rows"
```

---

### Task 9: Add Follow to Tournament Pages

**Files:**
- Modify: `src/app/v3/tournaments/[id]/page.tsx` (tournament header area)
- Modify: `src/app/v3/page.tsx` (TournamentSpotlight, around line 455)

- [ ] **Step 1: Add follow button to tournament detail header**

In `src/app/v3/tournaments/[id]/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

Find the tournament header area and add a FollowButton next to the tournament name/info:

```typescript
<FollowButton type="tournament" targetId={activeTournament.id} variant="follow" />
```

- [ ] **Step 2: Add follow icon to TournamentSpotlight on home page**

In `src/app/v3/page.tsx`, find the `TournamentSpotlight` component (around line 455). Add a small follow button in the tournament card header area:

```typescript
<FollowButton type="tournament" targetId={tournament.id} variant="star" size={14} style={{ position: 'absolute', top: 12, right: 12 }} />
```

- [ ] **Step 3: Verify in browser**

- Tournament detail page: Follow button visible, toggles state
- Home page Tournament Spotlight: Star icon in corner
- Followed tournaments appear in Following page Tournaments section

- [ ] **Step 4: Commit**

```bash
git add src/app/v3/tournaments/[id]/page.tsx src/app/v3/page.tsx
git commit -m "feat: add follow button to tournament pages and spotlight"
```

---

### Task 10: Add Follow to Feed & Match Detail

**Files:**
- Modify: `src/app/v3/feed/page.tsx` (article cards, source name area)
- Modify: `src/app/match/[id]/page.tsx` (match header + player names)

- [ ] **Step 1: Add follow source link to feed article cards**

In `src/app/v3/feed/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

In the `NewsCard` component, find where `source_name` is displayed and add a follow action next to it. Add after the source name text:

```typescript
<FollowButton type="news_source" targetId={item.source_name} variant="heart" size={12} />
```

- [ ] **Step 2: Add bookmark star to match detail header**

In `src/app/match/[id]/page.tsx`, add the import:

```typescript
import FollowButton from '@/components/FollowButton'
```

Find the match header area and add a bookmark star:

```typescript
<FollowButton type="match" targetId={match.id} variant="star" size={20} />
```

- [ ] **Step 3: Add follow hearts next to player names in match detail**

In the match detail page, find where player names are rendered and add small follow hearts:

```typescript
<FollowButton type="player" targetId={player.id} variant="heart" size={14} />
```

Add this next to each of the 4 player names in the match header.

- [ ] **Step 4: Verify in browser**

- Feed page: Small heart icon next to each article's source name
- Match detail: Star bookmark in header, heart icons next to each player name
- All toggle states persist across page navigation

- [ ] **Step 5: Commit**

```bash
git add src/app/v3/feed/page.tsx src/app/match/[id]/page.tsx
git commit -m "feat: add follow actions to feed articles and match detail page"
```

---

### Task 11: Final Integration Test & Cleanup

- [ ] **Step 1: End-to-end flow test**

Verify this full flow works:
1. Open `/v3/following` — see empty state with "Browse Players" CTA
2. Go to rankings, tap heart on a player → heart fills green
3. Go back to Following → player appears in Players section
4. Go to home, tap star on a match card → star fills gold
5. Go to Following → match appears in Live & Upcoming
6. Go to tournament detail, tap Follow → button shows "Following"
7. Go to Following → tournament appears in Tournaments section
8. Tap a followed player card → navigates to their profile
9. Refresh page → all follows persist (localStorage)

- [ ] **Step 2: Check for console errors**

Open browser dev tools and navigate through all pages. Ensure no React errors, hydration mismatches, or broken imports.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from favorites system testing"
```

- [ ] **Step 4: Final commit with all changes**

```bash
git log --oneline -10
```

Verify the commit history looks clean with incremental, well-named commits.

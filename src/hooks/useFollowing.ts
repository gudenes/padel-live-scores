'use client'
// src/hooks/useFollowing.ts
// Unified follow/bookmark hook supporting matches, players, tournaments, and news sources.
// Dual-mode storage:
//   - Authenticated: reads/writes user_bookmarks table in Supabase (match/player/tournament)
//   - Anonymous: reads/writes localStorage for all types
// News sources are localStorage-only regardless of auth state.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { BOOKMARK_EVENT, type BookmarkEventDetail } from '@/components/BookmarkToast'
import { useAnonPush } from '@/hooks/useAnonPush'
import { tryEnablePushOrShowInstallNudge } from '@/lib/pwa-install'
import { requestReviewForReason } from '@/lib/app-review'

export type FollowType = 'match' | 'player' | 'tournament' | 'news_source' | 'article'

const STORAGE_KEY = 'pn_following'
const LEGACY_STORAGE_KEY = 'pn_bookmarked_matches'

interface FollowingStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
  articles: string[]
}

function emptyStore(): FollowingStore {
  return { matches: [], players: [], tournaments: [], news_sources: [], articles: [] }
}

function typeToField(type: FollowType): keyof FollowingStore {
  if (type === 'match') return 'matches'
  if (type === 'player') return 'players'
  if (type === 'tournament') return 'tournaments'
  if (type === 'article') return 'articles'
  return 'news_sources'
}

function readLocalStorage(): FollowingStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const store: FollowingStore = raw ? (JSON.parse(raw) as FollowingStore) : emptyStore()

    // One-time migration: pull old match bookmarks into the new structure
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const legacyIds: string[] = JSON.parse(legacy)
      const merged = Array.from(new Set([...(store.matches ?? []), ...legacyIds]))
      store.matches = merged
      // Write merged state and remove old key
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }

    return {
      matches: store.matches ?? [],
      players: store.players ?? [],
      tournaments: store.tournaments ?? [],
      news_sources: store.news_sources ?? [],
      articles: store.articles ?? [],
    }
  } catch {
    return emptyStore()
  }
}

function writeLocalStorage(store: FollowingStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {}
}

// ── Deduplicated bookmarks fetch ─────────────────────────────
// Multiple components use useFollowing() — without dedup, each instance
// fires its own fetch('/api/user/bookmarks'), causing N duplicate requests
// that queue on the Supabase pooler and take seconds.
let _bookmarksPromise: Promise<{ bookmark_type: string; target_id: string }[]> | null = null
let _bookmarksUserId: string | null = null

function fetchBookmarksDeduplicated(userId: string): Promise<{ bookmark_type: string; target_id: string }[]> {
  // If we already have an in-flight promise for the same user, reuse it
  if (_bookmarksPromise && _bookmarksUserId === userId) return _bookmarksPromise
  _bookmarksUserId = userId
  _bookmarksPromise = fetch('/api/user/bookmarks')
    .then(res => res.ok ? res.json() : [])
    .finally(() => {
      // Clear after 2s so subsequent calls (e.g., after toggle) refetch
      setTimeout(() => { _bookmarksPromise = null }, 2000)
    })
  return _bookmarksPromise
}

// Invalidate the cached bookmarks snapshot immediately. Called after a
// toggle mutation so that any subsequent load() triggered by a parent
// re-render gets fresh data (not a stale snapshot from before the mutation).
function invalidateBookmarksCache() {
  _bookmarksPromise = null
  _bookmarksUserId = null
}

// DB types use singular names matching the existing bookmark_type column convention
function typeToDbType(type: FollowType): string {
  return type // 'match' | 'player' | 'tournament' — news_source never goes to DB
}

// Whether this type is persisted to Supabase for authenticated users
const DB_TYPES: FollowType[] = ['match', 'player', 'tournament']

export function useFollowing() {
  const { user } = useAuth()
  const anonPush = useAnonPush()

  // Per-type Sets for O(1) lookups
  const [store, setStore] = useState<Record<FollowType, Set<string>>>({
    match: new Set(),
    player: new Set(),
    tournament: new Set(),
    news_source: new Set(),
    article: new Set(),
  })
  const [loaded, setLoaded] = useState(false)

  // Load state on mount or when the user's identity actually changes.
  // Depending on the memoized `user.id` (not the object ref) prevents
  // spurious reloads from re-renders that re-create the user literal.
  const userId = user?.id ?? null
  useEffect(() => {
    async function load() {
      // Always load localStorage first (includes news_sources + offline fallback)
      const local = readLocalStorage()

      if (userId) {
        const migrationFlagKey = `pn_migrated_to_user_${userId}`
        const alreadyMigrated =
          typeof window !== 'undefined' &&
          localStorage.getItem(migrationFlagKey) === '1'

        let dbRows = await fetchBookmarksDeduplicated(userId)

        // First-time-on-this-device migration: send any localStorage follows
        // that aren't already in the user's DB bookmarks. POST is idempotent
        // (route uses upsert with composite-key onConflict).
        if (!alreadyMigrated) {
          const { computeFollowMigration } = await import('@/lib/follow-migration')
          const toMigrate = computeFollowMigration(local, dbRows)
          let allSucceeded = true
          if (toMigrate.length > 0) {
            const results = await Promise.all(
              toMigrate.map(item =>
                fetch('/api/user/bookmarks', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(item),
                })
                  .then(r => r.ok)
                  .catch(() => false),
              ),
            )
            allSucceeded = results.every(Boolean)
            // Re-fetch so the in-memory store reflects what just got persisted.
            invalidateBookmarksCache()
            dbRows = await fetchBookmarksDeduplicated(userId)
          }
          // Only mark migration complete if every POST landed (or there was nothing
          // to migrate). On partial/total failure leave the flag unset so the next
          // session retries.
          if (allSucceeded) {
            try {
              localStorage.setItem(migrationFlagKey, '1')
            } catch {}
          }

          // Also migrate the device's anon push subscriptions (Spec 2). This is
          // independent of the bookmark migration above — even if no localStorage
          // follows existed, the device might still have an anon_push_subscriptions
          // row from a previous browse session. The endpoint is a no-op when no
          // device_id is set.
          void anonPush.migrateToUser()
        }

        const dbMatches = new Set<string>()
        const dbPlayers = new Set<string>()
        const dbTournaments = new Set<string>()

        for (const row of dbRows) {
          if (row.bookmark_type === 'match') dbMatches.add(row.target_id)
          else if (row.bookmark_type === 'player') dbPlayers.add(row.target_id)
          else if (row.bookmark_type === 'tournament') dbTournaments.add(row.target_id)
        }

        setStore({
          match: dbMatches,
          player: dbPlayers,
          tournament: dbTournaments,
          news_source: new Set(local.news_sources),
          article: new Set(local.articles),
        })
      } else {
        setStore({
          match: new Set(local.matches),
          player: new Set(local.players),
          tournament: new Set(local.tournaments),
          news_source: new Set(local.news_sources),
          article: new Set(local.articles),
        })
      }

      setLoaded(true)
    }

    load()
  }, [userId])

  const isFollowing = useCallback(
    (type: FollowType, targetId: string): boolean => store[type].has(targetId),
    [store],
  )

  const toggle = useCallback(
    async (
      type: FollowType,
      targetId: string,
      opts?: { silent?: boolean },
    ) => {
      const isCurrently = store[type].has(targetId)
      const silent = opts?.silent === true

      // Optimistic update
      setStore(prev => {
        const next = { ...prev, [type]: new Set(prev[type]) }
        if (isCurrently) next[type].delete(targetId)
        else next[type].add(targetId)

        // Always sync localStorage (source of truth for anonymous + news_sources + articles)
        if (!user || type === 'news_source' || type === 'article') {
          const field = typeToField(type)
          const local = readLocalStorage()
          local[field] = [...next[type]]
          writeLocalStorage(local)
        }

        return next
      })

      // Anonymous push side-effect: keep the server-side anon_bookmarks list
      // in sync with the user's localStorage follows so the push sender can
      // reach them. First follow with consent fires the permission prompt +
      // subscription register; subsequent toggles are PATCHes.
      if (!user && (type === 'player' || type === 'match')) {
        const bookmark = { type, target_id: targetId }
        if (isCurrently) {
          // unfollow → remove server-side
          void anonPush.removeBookmark(bookmark)
        } else {
          // follow → ensure subscription if first time, then add bookmark
          if (anonPush.pushAllowed && anonPush.supported) {
            // Read updated localStorage follows so the initial bookmark set
            // includes the entry we just added.
            const local = readLocalStorage()
            const initial: { type: 'player' | 'match'; target_id: string }[] = [
              ...local.players.map(id => ({ type: 'player' as const, target_id: id })),
              ...local.matches.map(id => ({ type: 'match' as const, target_id: id })),
            ]
            // ensureSubscription is idempotent — it returns immediately if
            // a subscription already exists. addBookmark fires after, in case
            // the subscription was already there.
            void (async () => {
              await tryEnablePushOrShowInstallNudge(initial, 'first_follow')
              await anonPush.addBookmark(bookmark)
            })()
          } else {
            // No push consent / unsupported browser → still try to add the
            // bookmark in case a subscription is already registered (rare
            // but possible if user revokes-then-re-grants consent).
            void anonPush.addBookmark(bookmark)
          }
        }
      }

      // Fire bookmark feedback toast (skip news_source + article — not user-facing bookmarks
      // that need toast feedback in the current toast component's type union)
      // Suppressed entirely when `silent: true` — used by the picker which writes
      // many follows at once and surfaces a single consolidated prompt instead.
      if (!silent && type !== 'news_source' && type !== 'article' && typeof window !== 'undefined') {
        // Attach the enable-push CTA on the first follow/bookmark-ADD when:
        //   (a) the action is a net-new follow (not an unfollow), and
        //   (b) the type is one the user wants real-time alerts on
        //       (match, player, tournament), and
        //   (c) the browser hasn't been asked about notifications yet
        //       (Notification.permission === 'default'), and
        //   (d) we haven't shown the prompt on this device before.
        //
        // Originally limited to type==='player' (the long-term "I care
        // about this person" signal) — extended 2026-04-26 to match +
        // tournament follows as well. Both are high-intent moments where
        // the natural follow-up question is "tell me when something
        // happens with this." Tournament-follow → notify on next-round
        // start; match-bookmark → notify when the match goes live.
        //
        // The localStorage `pn_push_prompted` gate is type-agnostic, so
        // a user who bookmarks a match THEN follows a player won't get
        // double-prompted — first one wins, then we leave them alone.
        const isPushOpportunity =
          !isCurrently &&
          (type === 'match' || type === 'player' || type === 'tournament')
        let cta: 'enable-push' | undefined
        if (isPushOpportunity) {
          try {
            const alreadyPrompted = localStorage.getItem('pn_push_prompted') === '1'
            const browserPermission = 'Notification' in window ? Notification.permission : 'denied'
            if (!alreadyPrompted && browserPermission === 'default') {
              cta = 'enable-push'
            }
          } catch { /* permission check failed — skip CTA */ }
        }
        window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, {
          detail: {
            type,
            action: isCurrently ? 'remove' : 'add',
            ...(cta ? { cta } : {}),
          } satisfies BookmarkEventDetail,
        }))
      }

      // In-app review nudge: a net-new player/tournament follow is a
      // high-intent "I care about this app" moment. Gated in app-review.ts,
      // so most follows won't actually surface the prompt. Fire-and-forget;
      // never blocks the toggle. Excludes match + news_source by design.
      if (!isCurrently && (type === 'player' || type === 'tournament')) {
        void requestReviewForReason('favorite')
      }

      // Persist to Supabase for authenticated users (non-news_source, non-article types only)
      if (user && type !== 'news_source' && type !== 'article') {
        const dbType = typeToDbType(type)
        // Invalidate dedup cache so a subsequent parent re-render that
        // retriggers load() fetches fresh data instead of a pre-mutation
        // snapshot — prevents the optimistic UI from flipping back.
        invalidateBookmarksCache()
        if (isCurrently) {
          await fetch('/api/user/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmark_type: dbType, target_id: targetId }),
          })
        } else {
          await fetch('/api/user/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmark_type: dbType, target_id: targetId }),
          })
        }
      }
    },
    [user, store],
  )

  const getFollowed = useCallback(
    (type: FollowType): string[] => [...store[type]],
    [store],
  )

  const counts: Record<FollowType, number> = {
    match: store.match.size,
    player: store.player.size,
    tournament: store.tournament.size,
    news_source: store.news_source.size,
    article: store.article.size,
  }

  return { isFollowing, toggle, getFollowed, counts, loaded }
}

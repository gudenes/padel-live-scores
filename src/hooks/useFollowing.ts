'use client'
// src/hooks/useFollowing.ts
// Unified follow/bookmark hook supporting matches, players, tournaments, and news sources.
// Dual-mode storage:
//   - Authenticated: reads/writes user_bookmarks table in Supabase (match/player/tournament)
//   - Anonymous: reads/writes localStorage for all types
// News sources are localStorage-only regardless of auth state.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

export type FollowType = 'match' | 'player' | 'tournament' | 'news_source'

const STORAGE_KEY = 'pn_following'
const LEGACY_STORAGE_KEY = 'pn_bookmarked_matches'

interface FollowingStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
}

function emptyStore(): FollowingStore {
  return { matches: [], players: [], tournaments: [], news_sources: [] }
}

function typeToField(type: FollowType): keyof FollowingStore {
  if (type === 'match') return 'matches'
  if (type === 'player') return 'players'
  if (type === 'tournament') return 'tournaments'
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

// DB types use singular names matching the existing bookmark_type column convention
function typeToDbType(type: FollowType): string {
  return type // 'match' | 'player' | 'tournament' — news_source never goes to DB
}

// Whether this type is persisted to Supabase for authenticated users
const DB_TYPES: FollowType[] = ['match', 'player', 'tournament']

export function useFollowing() {
  const { user } = useAuth()

  // Per-type Sets for O(1) lookups
  const [store, setStore] = useState<Record<FollowType, Set<string>>>({
    match: new Set(),
    player: new Set(),
    tournament: new Set(),
    news_source: new Set(),
  })
  const [loaded, setLoaded] = useState(false)

  // Load state on mount or when auth changes
  useEffect(() => {
    async function load() {
      // Always load localStorage first (includes news_sources + offline fallback)
      const local = readLocalStorage()

      if (user) {
        // Fetch DB types from Supabase in one query
        const { data } = await supabase
          .from('user_bookmarks')
          .select('bookmark_type, target_id')
          .eq('user_id', user.id)
          .in('bookmark_type', DB_TYPES)

        const dbMatches = new Set<string>()
        const dbPlayers = new Set<string>()
        const dbTournaments = new Set<string>()

        for (const row of data ?? []) {
          if (row.bookmark_type === 'match') dbMatches.add(row.target_id)
          else if (row.bookmark_type === 'player') dbPlayers.add(row.target_id)
          else if (row.bookmark_type === 'tournament') dbTournaments.add(row.target_id)
        }

        setStore({
          match: dbMatches,
          player: dbPlayers,
          tournament: dbTournaments,
          news_source: new Set(local.news_sources),
        })
      } else {
        setStore({
          match: new Set(local.matches),
          player: new Set(local.players),
          tournament: new Set(local.tournaments),
          news_source: new Set(local.news_sources),
        })
      }

      setLoaded(true)
    }

    load()
  }, [user])

  const isFollowing = useCallback(
    (type: FollowType, targetId: string): boolean => store[type].has(targetId),
    [store],
  )

  const toggle = useCallback(
    async (type: FollowType, targetId: string) => {
      const isCurrently = store[type].has(targetId)

      // Optimistic update
      setStore(prev => {
        const next = { ...prev, [type]: new Set(prev[type]) }
        if (isCurrently) next[type].delete(targetId)
        else next[type].add(targetId)

        // Always sync localStorage (source of truth for anonymous + news_sources)
        if (!user || type === 'news_source') {
          const field = typeToField(type)
          const local = readLocalStorage()
          local[field] = [...next[type]]
          writeLocalStorage(local)
        }

        return next
      })

      // Persist to Supabase for authenticated users (non-news_source types only)
      if (user && type !== 'news_source') {
        const dbType = typeToDbType(type)
        if (isCurrently) {
          await supabase
            .from('user_bookmarks')
            .delete()
            .eq('user_id', user.id)
            .eq('bookmark_type', dbType)
            .eq('target_id', targetId)
        } else {
          await supabase.from('user_bookmarks').insert({
            user_id: user.id,
            bookmark_type: dbType,
            target_id: targetId,
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
  }

  return { isFollowing, toggle, getFollowed, counts, loaded }
}

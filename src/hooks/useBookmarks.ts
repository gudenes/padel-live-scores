'use client'
// src/hooks/useBookmarks.ts
// @deprecated — thin backwards-compatible wrapper around useFollowing.
// Prefer useFollowing directly for new code.

import { useCallback, useMemo } from 'react'
import { useFollowing } from './useFollowing'

export function useBookmarks() {
  const { isFollowing, toggle: followingToggle, getFollowed, counts, loaded } = useFollowing()

  const isBookmarked = useCallback(
    (matchId: string) => isFollowing('match', matchId),
    [isFollowing],
  )

  const toggle = useCallback(
    (matchId: string) => followingToggle('match', matchId),
    [followingToggle],
  )

  const matchCount = counts.match
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bookmarked = useMemo(() => new Set(getFollowed('match')), [matchCount])

  return { isBookmarked, toggle, bookmarked, loaded }
}

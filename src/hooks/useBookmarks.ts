'use client'
// src/hooks/useBookmarks.ts
// @deprecated — thin backwards-compatible wrapper around useFollowing.
// Prefer useFollowing directly for new code.

import { useCallback } from 'react'
import { useFollowing } from './useFollowing'

export function useBookmarks() {
  const { isFollowing, toggle: followingToggle, getFollowed, loaded } = useFollowing()

  const isBookmarked = useCallback(
    (matchId: string) => isFollowing('match', matchId),
    [isFollowing],
  )

  const toggle = useCallback(
    (matchId: string) => followingToggle('match', matchId),
    [followingToggle],
  )

  const bookmarked = new Set(getFollowed('match'))

  return { isBookmarked, toggle, bookmarked, loaded }
}

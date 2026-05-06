'use client'
// useAnonPush — React wrapper around src/lib/anon-push.ts.
//
// Exposes memoised callbacks that automatically gate on the user's
// cookie-banner push consent (Spec 1) AND browser support. Consumers
// (useFollowing, NotificationPromptSheet, BookmarkToast) call the
// returned functions without re-implementing the gating logic.

import { useCallback } from 'react'
import { useConsent } from '@/hooks/useConsent'
import {
  ensureSubscription as libEnsureSubscription,
  addBookmark as libAddBookmark,
  removeBookmark as libRemoveBookmark,
  unsubscribe as libUnsubscribe,
  migrateToUser as libMigrateToUser,
  isPushSupported,
  type AnonBookmark,
} from '@/lib/anon-push'

export function useAnonPush() {
  const { isPushAllowed } = useConsent()

  const ensureSubscription = useCallback(
    async (initialBookmarks: AnonBookmark[]): Promise<boolean> => {
      if (!isPushAllowed()) return false
      return libEnsureSubscription(initialBookmarks)
    },
    [isPushAllowed],
  )

  const addBookmark = useCallback(
    async (b: AnonBookmark): Promise<void> => {
      if (!isPushAllowed()) return
      return libAddBookmark(b)
    },
    [isPushAllowed],
  )

  const removeBookmark = useCallback(
    async (b: AnonBookmark): Promise<void> => {
      if (!isPushAllowed()) return
      return libRemoveBookmark(b)
    },
    [isPushAllowed],
  )

  const unsubscribe = useCallback(async (): Promise<void> => {
    return libUnsubscribe()
  }, [])

  const migrateToUser = useCallback(async (): Promise<void> => {
    return libMigrateToUser()
  }, [])

  return {
    supported: isPushSupported(),
    pushAllowed: isPushAllowed(),
    ensureSubscription,
    addBookmark,
    removeBookmark,
    unsubscribe,
    migrateToUser,
  }
}

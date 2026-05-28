'use client'

// Context + hook that drives the home → For You overlay.
//
// The OVERLAY itself (slide-up panel) lives in
// src/components/feed/foryou/ForYouOverlay.tsx and reads from this context.
// Any surface that wants to deep-link into For You (home rail card, embedded
// player card, push notification) just calls openForYou(articleId).

import {
  createContext, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from 'react'

interface ForYouOverlayState {
  isOpen: boolean
  articleId: string | null
  openForYou: (articleId: string) => void
  closeForYou: () => void
}

const Ctx = createContext<ForYouOverlayState | null>(null)

export function ForYouOverlayProvider({ children }: { children: ReactNode }) {
  const [articleId, setArticleId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const openForYou = useCallback((id: string) => {
    setArticleId(id)
    setIsOpen(true)
  }, [])

  const closeForYou = useCallback(() => {
    setIsOpen(false)
    // We keep articleId until the next open — lets the overlay's exit
    // animation finish without the inner article suddenly going blank.
  }, [])

  const value = useMemo(
    () => ({ isOpen, articleId, openForYou, closeForYou }),
    [isOpen, articleId, openForYou, closeForYou],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useForYouOverlay(): ForYouOverlayState {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useForYouOverlay must be used inside <ForYouOverlayProvider>')
  }
  return ctx
}

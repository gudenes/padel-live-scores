'use client'
// apps/ops/src/components/player-drawer-context.tsx
// Global drawer state — any surface (Matches, Draws, OOP, Entry Lists, Players)
// can call useOpenPlayerDrawer().open(id) to slide the PlayerDrawer in without
// navigating. PlayerDrawerHost (mounted in (app)/layout.tsx) subscribes to this
// state and renders the drawer.
//
// Callback wiring: PlayerDrawer has two list-aware callbacks — onSaved (refresh
// the list after an edit) and onNavigate (arrow-key prev/next within the list).
// Only PlayersTab "owns" a list, so it registers both callbacks via
// useRegisterDrawerCallbacks. Other surfaces (e.g. opening from a Matches row)
// leave them unregistered — the drawer's prev/next buttons just no-op and
// nothing fires on save.
//
// Refs are kept inside the provider component (not exposed on the context
// value) so React's new immutability lint doesn't flag external mutation. The
// provider exposes register/get functions that close over its own refs.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type NavigateDirection = 'prev' | 'next'

interface PlayerDrawerContextValue {
  openPlayerId: string | null
  open: (playerId: string) => void
  close: () => void
  /** Register list-aware callbacks. Pass null to clear. */
  registerCallbacks: (cbs: {
    onSaved: (() => void) | null
    onNavigate: ((direction: NavigateDirection) => void) | null
  }) => void
  /** Internal — invokes whatever onSaved is currently registered. */
  emitSaved: () => void
  /** Internal — invokes whatever onNavigate is currently registered. */
  emitNavigate: (direction: NavigateDirection) => void
}

const PlayerDrawerContext = createContext<PlayerDrawerContextValue | null>(null)

export function PlayerDrawerProvider({ children }: { children: ReactNode }) {
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null)
  const onSavedRef = useRef<(() => void) | null>(null)
  const onNavigateRef = useRef<((direction: NavigateDirection) => void) | null>(null)

  const open = useCallback((playerId: string) => setOpenPlayerId(playerId), [])
  const close = useCallback(() => setOpenPlayerId(null), [])

  const registerCallbacks = useCallback(
    (cbs: {
      onSaved: (() => void) | null
      onNavigate: ((direction: NavigateDirection) => void) | null
    }) => {
      onSavedRef.current = cbs.onSaved
      onNavigateRef.current = cbs.onNavigate
    },
    [],
  )

  const emitSaved = useCallback(() => {
    onSavedRef.current?.()
  }, [])

  const emitNavigate = useCallback((direction: NavigateDirection) => {
    onNavigateRef.current?.(direction)
  }, [])

  const value = useMemo<PlayerDrawerContextValue>(
    () => ({ openPlayerId, open, close, registerCallbacks, emitSaved, emitNavigate }),
    [openPlayerId, open, close, registerCallbacks, emitSaved, emitNavigate],
  )

  return (
    <PlayerDrawerContext.Provider value={value}>
      {children}
    </PlayerDrawerContext.Provider>
  )
}

const NOOP_DRAWER: {
  open: (id: string) => void
  close: () => void
  openPlayerId: string | null
} = {
  open: () => { /* no-op outside provider */ },
  close: () => { /* no-op outside provider */ },
  openPlayerId: null,
}

/**
 * Public hook — narrow API for triggering the drawer from any surface.
 * Returns no-ops when called outside a provider (so PlayerLink-style components
 * don't crash in storybook / unit-test contexts that skip the provider).
 */
export function useOpenPlayerDrawer(): {
  open: (id: string) => void
  close: () => void
  openPlayerId: string | null
} {
  const ctx = useContext(PlayerDrawerContext)
  return useMemo(() => {
    if (!ctx) return NOOP_DRAWER
    return { open: ctx.open, close: ctx.close, openPlayerId: ctx.openPlayerId }
  }, [ctx])
}

/**
 * Register list-aware callbacks. Call this from any page that "owns" a player
 * list — the drawer will fire onSaved after edits and onNavigate when the user
 * presses ↑/↓ or clicks the prev/next buttons. Auto-unregisters on unmount or
 * when callbacks change.
 *
 * Both args are optional — undefined means "no callback for this slot".
 */
export function useRegisterDrawerCallbacks({
  onSaved,
  onNavigate,
}: {
  onSaved?: () => void
  onNavigate?: (direction: NavigateDirection) => void
}) {
  const ctx = useContext(PlayerDrawerContext)
  const register = ctx?.registerCallbacks
  useEffect(() => {
    if (!register) return
    register({ onSaved: onSaved ?? null, onNavigate: onNavigate ?? null })
    return () => {
      register({ onSaved: null, onNavigate: null })
    }
  }, [register, onSaved, onNavigate])
}

/** Internal — used by PlayerDrawerHost. Throws if used outside the provider. */
export function useInternalDrawerContext(): PlayerDrawerContextValue {
  const ctx = useContext(PlayerDrawerContext)
  if (!ctx) throw new Error('PlayerDrawerHost must be wrapped in PlayerDrawerProvider')
  return ctx
}

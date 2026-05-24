'use client'
// apps/ops/src/components/PlayerDrawerHost.tsx
// Renders the PlayerDrawer at app-shell scope. Subscribes to the drawer context
// for the open player id; forwards onSaved/onNavigate to whatever list page
// registered itself via useRegisterDrawerCallbacks.

import PlayerDrawer from './PlayerDrawer'
import { useInternalDrawerContext } from './player-drawer-context'

export function PlayerDrawerHost() {
  const { openPlayerId, close, emitSaved, emitNavigate } = useInternalDrawerContext()

  // PlayerDrawer renders null when playerId is null, but we early-out anyway so
  // the keyboard listener effect inside the drawer doesn't churn on every page.
  if (!openPlayerId) return null

  return (
    <PlayerDrawer
      playerId={openPlayerId}
      onClose={close}
      onSaved={emitSaved}
      onNavigate={emitNavigate}
    />
  )
}

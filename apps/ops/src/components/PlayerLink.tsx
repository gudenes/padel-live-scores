// apps/ops/src/components/PlayerLink.tsx
// Shared player-name renderer used across Entry Lists, Tournament Matches,
// Draws, OOP, and any other operator surface that lists players.
// - Status dot indicates linked/thin/unresolved
// - Hovering opens PlayerHoverCard (200ms delay, 100ms close grace)
// - Click opens the global PlayerDrawer via context (no navigation)
// - Unresolved players: italic gray text, no hover card, no click
'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  computePlayerLinkStatus,
  type PlayerLinkInput,
  type PlayerLinkStatus,
} from '@/lib/player-link-status'
import { PlayerHoverCard } from './PlayerHoverCard'
import { useOpenPlayerDrawer } from './player-drawer-context'

interface Props {
  player: PlayerLinkInput
  /** Optional small badges rendered after the name. Defaults to none. */
  badges?: ReactNode
  /** Hide the status dot. */
  hideDot?: boolean
  /** Override tooltip text (otherwise derived from status). */
  tooltip?: string
}

const STATUS_DOT_COLOR: Record<PlayerLinkStatus, string> = {
  enriched: 'var(--lime, #84cc16)',
  thin: 'var(--status-warn, #f59e0b)',
  unresolved: 'var(--status-neutral, #71717a)',
}

const STATUS_TOOLTIP: Record<PlayerLinkStatus, string> = {
  enriched: 'Linked + enriched (avatar / ranking / padelapi)',
  thin: 'Linked but thin profile — needs enrichment',
  unresolved: 'No profile yet — name only',
}

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_GRACE_MS = 100

export function PlayerLink({ player, badges, hideDot, tooltip }: Props) {
  const status = computePlayerLinkStatus(player)
  const tip = tooltip ?? STATUS_TOOLTIP[status]
  const drawer = useOpenPlayerDrawer()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const setNameRef = useCallback((el: HTMLElement | null) => {
    setAnchorEl(el)
  }, [])
  const [showCard, setShowCard] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelTimers = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const scheduleOpen = () => {
    if (status === 'unresolved') return
    cancelTimers()
    openTimerRef.current = setTimeout(() => {
      setShowCard(true)
      openTimerRef.current = null
    }, HOVER_OPEN_DELAY_MS)
  }

  const scheduleClose = () => {
    cancelTimers()
    closeTimerRef.current = setTimeout(() => {
      setShowCard(false)
      closeTimerRef.current = null
    }, HOVER_CLOSE_GRACE_MS)
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!player.id) return
    e.preventDefault()
    cancelTimers()
    setShowCard(false)
    drawer.open(player.id)
  }

  const dot = !hideDot && (
    <span
      aria-hidden
      title={tip}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: STATUS_DOT_COLOR[status],
        flexShrink: 0,
      }}
    />
  )

  const nameNode =
    status === 'unresolved' || !player.id ? (
      <span
        title={tip}
        style={{
          color: 'var(--status-neutral, #71717a)',
          fontStyle: 'italic',
        }}
      >
        {player.name}
      </span>
    ) : (
      <span
        ref={setNameRef}
        title={tip}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick(e as unknown as React.MouseEvent)
          }
        }}
        style={{
          color: 'inherit',
          cursor: 'pointer',
          borderBottom: '1px dashed transparent',
          transition:
            'border-color var(--dur-fast, 120ms) var(--ease-out, ease-out), color var(--dur-fast, 120ms) var(--ease-out, ease-out)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = '2px solid var(--lime, #84cc16)'
          e.currentTarget.style.outlineOffset = '2px'
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = 'none'
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.borderBottomColor = 'var(--lime, #84cc16)'
          e.currentTarget.style.color = 'var(--lime-deep, #65a30d)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.borderBottomColor = 'transparent'
          e.currentTarget.style.color = 'inherit'
        }}
      >
        {player.name}
      </span>
    )

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1.3 }}>
        {dot}
        {nameNode}
        {badges}
      </span>

      {showCard && anchorEl && (
        <PlayerHoverCard
          anchor={anchorEl}
          player={player}
          onClose={() => {
            // Card's onMouseLeave fires this; close immediately
            cancelTimers()
            setShowCard(false)
          }}
          onMouseEnter={() => {
            // Cursor moved from name into card — cancel pending close
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current)
              closeTimerRef.current = null
            }
          }}
        />
      )}
    </>
  )
}

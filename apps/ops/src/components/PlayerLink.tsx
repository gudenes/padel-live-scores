// Shared player-name renderer used across Entry Lists, Tournament Matches,
// Draws, OOP, and any other operator surface that lists players.
// Renders a status dot + name. When linked, the name links to /players/[id].
// On hover, a tooltip explains the dot color.
'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { computePlayerLinkStatus, type PlayerLinkInput, type PlayerLinkStatus } from '@/lib/player-link-status'

interface Props {
  player: PlayerLinkInput
  /** Optional small badges rendered after the name (e.g. FIP, padelapi). Defaults to none. */
  badges?: ReactNode
  /** Hide the status dot — useful when the surface already shows resolution status another way. */
  hideDot?: boolean
  /** Override the tooltip text. */
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

export function PlayerLink({ player, badges, hideDot, tooltip }: Props) {
  const status = computePlayerLinkStatus(player)
  const tip = tooltip ?? STATUS_TOOLTIP[status]
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
      <Link
        href={`/players/${player.id}`}
        title={tip}
        style={{
          color: 'inherit',
          textDecoration: 'none',
          borderBottom: '1px dashed transparent',
          transition: 'border-color var(--dur-fast, 120ms) var(--ease-out, ease-out), color var(--dur-fast, 120ms) var(--ease-out, ease-out)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderBottomColor = 'var(--lime, #84cc16)'
          e.currentTarget.style.color = 'var(--lime-deep, #65a30d)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderBottomColor = 'transparent'
          e.currentTarget.style.color = 'inherit'
        }}
      >
        {player.name}
      </Link>
    )

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1.3 }}>
      {dot}
      {nameNode}
      {badges}
    </span>
  )
}

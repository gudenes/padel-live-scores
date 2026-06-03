'use client'

// Floating preview card shown when the user hovers a player name (PlayerLink).
// Reuses PlayerLinkInput data — no network calls. T4 wires this into PlayerLink
// with a 100ms grace period so the cursor can travel between anchor and card
// without closing.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import type { PlayerLinkInput } from '@/lib/player-link-status'

interface Props {
  /** Anchor element — the player name span the user is hovering. */
  anchor: HTMLElement | null
  /** Player data to render. */
  player: PlayerLinkInput
  /** Called when the card requests close (mouse left the card). */
  onClose: () => void
  /** Called when the cursor enters the card itself (parent uses this to cancel its pending close timer). */
  onMouseEnter?: () => void
}

const CARD_WIDTH = 280
const CARD_HEIGHT_EST = 200
const GAP = 8

function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function computePosition(anchor: HTMLElement): {
  top: number
  left: number
  placement: 'above' | 'below'
} {
  const rect = anchor.getBoundingClientRect()
  const wantsAbove = rect.top > window.innerHeight - CARD_HEIGHT_EST - GAP - 20
  const top = wantsAbove
    ? rect.top - CARD_HEIGHT_EST - GAP + window.scrollY
    : rect.bottom + GAP + window.scrollY
  const rawLeft = rect.left + window.scrollX
  const maxLeft = window.innerWidth + window.scrollX - CARD_WIDTH - 8
  const left = Math.max(8, Math.min(rawLeft, maxLeft))
  return { top, left, placement: wantsAbove ? 'above' : 'below' }
}

export function PlayerHoverCard({ anchor, player, onClose, onMouseEnter }: Props) {
  // SSR guard — document.body doesn't exist on the server. Cheap ref check
  // means we don't need a setState-in-effect dance.
  const isClient = typeof document !== 'undefined'

  // Seed position from the anchor synchronously at first render. The effect
  // below recomputes if the anchor element identity changes mid-life.
  const [pos, setPos] = useState(() =>
    anchor && typeof window !== 'undefined'
      ? computePosition(anchor)
      : { top: 0, left: 0, placement: 'below' as const },
  )
  const cardRef = useRef<HTMLDivElement>(null)
  const lastAnchorRef = useRef<HTMLElement | null>(anchor)

  // Recompute position when the anchor element identity changes (e.g. caller
  // points the card at a different name). Reads layout in a rAF so it doesn't
  // fight a concurrent commit and so the synchronous-setState-in-effect lint
  // rule is satisfied (the setState lives inside an async callback).
  useEffect(() => {
    if (!anchor) return
    if (lastAnchorRef.current === anchor) return
    lastAnchorRef.current = anchor
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      setPos(computePosition(anchor))
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [anchor])

  if (!isClient || !anchor) return null

  const cn = countryName(player.country)
  const ranking = player.ranking != null ? `#${player.ranking}` : null
  const categoryLabel =
    player.category === 'men' ? 'Men' : player.category === 'women' ? 'Women' : null
  const meta = [cn, categoryLabel, ranking].filter(Boolean).join(' · ')

  const externalIds: Array<[string, string]> = []
  if (player.fip_id) externalIds.push(['FIP', player.fip_id])
  if (player.padelapi_id) externalIds.push(['padelapi', player.padelapi_id])

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`${player.name} preview`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        width: CARD_WIDTH,
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-card)',
        borderRadius: 12,
        padding: 14,
        boxShadow: '0 10px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)',
        zIndex: 9999,
        animation: 'opsHoverCardFadeIn 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header row: avatar + name + meta */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar player={player} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-1)',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {player.name}
          </div>
          {meta && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                marginTop: 3,
                lineHeight: 1.3,
              }}
            >
              {meta}
            </div>
          )}
        </div>
      </div>

      {/* External IDs */}
      {externalIds.length > 0 && (
        <>
          <div
            style={{
              borderTop: '1px solid var(--border-card)',
              margin: '10px 0',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {externalIds.map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                <span style={{ width: 60, color: 'var(--text-3)' }}>{label}</span>
                <span
                  style={{
                    fontFamily:
                      'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    color: 'var(--text-1)',
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Open full profile link */}
      {player.id && (
        <>
          <div
            style={{
              borderTop: '1px solid var(--border-card)',
              margin: '10px 0',
            }}
          />
          <Link
            href={`/players/${player.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--lime-deep, #65a30d)',
              textDecoration: 'none',
            }}
          >
            Open full profile →
          </Link>
        </>
      )}

      <style>{`
        @keyframes opsHoverCardFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  )
}

function Avatar({ player }: { player: PlayerLinkInput }) {
  const [failed, setFailed] = useState(false)
  if (player.avatar_url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.avatar_url}
        alt={player.name}
        onError={() => setFailed(true)}
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          objectFit: 'cover',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        background:
          'linear-gradient(135deg, var(--lime-bright, #a3e635) 0%, var(--lime-deep, #65a30d) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 800,
        fontSize: 18,
        letterSpacing: '-0.02em',
        flexShrink: 0,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      }}
    >
      {initials(player.name)}
    </div>
  )
}

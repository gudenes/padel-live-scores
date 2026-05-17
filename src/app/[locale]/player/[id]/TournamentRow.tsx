import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TrophyIcon } from '@/components/icons/TrophyIcon'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

const LEVEL_FLAG: Record<string, string> = {
  premier_p1: LIVE_RED,
  premier_p2: LIVE_RED,
  premier_major: LIVE_RED,
  premier_mens: LIVE_RED,
  premier_womens: LIVE_RED,
  fip_gold: '#D4A017',
  fip_silver: '#94A3B8',
  fip_bronze: '#B45309',
}

function titleCase(s: string): string {
  return s.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

export type TournamentRoundCode =
  | 'W' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q1' | 'Q2' | 'Q3'

interface Props {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  /** Round pill code, e.g. 'W' for winner, 'SF' for semifinal. */
  round: TournamentRoundCode
  /** Right side display: either a € amount or a record string like "5 partidas · 4-1" */
  trailing: string
  /** Show a gold trophy icon at the far right edge (for title rows). */
  showTrophy?: boolean
  /** Date subtitle text, already formatted. */
  dateText?: string
}

export function TournamentRow({
  tournamentId,
  tournamentName,
  tournamentLevel,
  round,
  trailing,
  showTrophy = false,
  dateText,
}: Props) {
  const t = useTranslations('player.roundLabel')
  const flag = (tournamentLevel && LEVEL_FLAG[tournamentLevel]) || MUTED
  const isWinner = round === 'W'
  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1.5px 6px',
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.5,
    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
    textTransform: 'uppercase',
    ...(isWinner
      ? { background: '#D4A017', color: '#000' }
      : round === 'F'
        ? { background: 'rgba(212,160,23,0.15)', color: '#D4A017', border: '1px solid rgba(212,160,23,0.35)' }
        : { background: 'rgba(255,255,255,0.06)', color: '#B8B8B8' }),
  }

  return (
    <Link
      href={`/tournaments/${tournamentId}`}
      style={{
        background: BG_CARD2,
        padding: '10px 12px',
        clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', background: flag, borderRadius: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {titleCase(tournamentName)}
        </div>
        <div style={{ fontSize: 9, color: MUTED, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={pillStyle}>{t(round)}</span>
          {dateText && <span>· {dateText}</span>}
        </div>
      </div>
      <div
        style={{
          color: GREEN,
          fontWeight: 800,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {trailing}
      </div>
      {showTrophy && (
        <div
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(212,160,23,0.15)',
            clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
            flexShrink: 0,
          }}
        >
          <TrophyIcon size={14} />
        </div>
      )}
    </Link>
  )
}

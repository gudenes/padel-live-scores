// src/app/[locale]/(app)/rankings/RankingsTable.tsx
// Presentational rankings table. Renderable from both server (initial
// SSR) and client (post-toggle re-render). No useState/useRouter.

import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import FollowButton from '@/components/FollowButton'
import {
  BG_CARD, BORDER, CHUNKY, MUTED,
  countryNameForLocale, countryFlagUrl,
  RankBadge, DeltaChip,
  type Player, type RankType,
} from './shared'

type Props = {
  players: Player[]
  rankType: RankType
  locale: string
  visibleCount?: number
}

export function RankingsTable({ players, rankType, locale, visibleCount }: Props) {
  const rows = visibleCount ? players.slice(0, visibleCount) : players
  return (
    <div style={{
      background: BG_CARD,
      clipPath: CHUNKY.card,
      borderTop: `1px solid ${BORDER}`,
    }}>
      {rows.map((p) => {
        const rank = rankType === 'official' ? p.ranking : p.race_ranking
        const points = rankType === 'official' ? p.points : p.race_points
        const move = rankType === 'official' ? p.ranking_move : p.race_move
        const flag = countryFlagUrl(p.country)
        const country = countryNameForLocale(p.country, locale)
        return (
          <div
            key={p.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr auto auto auto',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <Link
              href={`/player/${p.id}`}
              prefetch={false}
              style={{
                display: 'contents',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <RankBadge rank={rank} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {p.avatar_url ? (
                  <Image
                    src={p.avatar_url}
                    alt=""
                    width={32}
                    height={32}
                    style={{ borderRadius: '50%', objectFit: 'cover' }}
                    unoptimized
                  />
                ) : (
                  <span style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: BORDER, display: 'inline-block',
                  }} aria-hidden />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {flag && (
                      <Image src={flag} alt="" width={12} height={9} style={{ display: 'inline-block' }} unoptimized />
                    )}
                    {country}
                  </span>
                </div>
              </div>
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                fontSize: 13, color: '#fff', fontWeight: 600,
              }}>
                {points?.toLocaleString(locale) ?? '--'}
              </span>
              <DeltaChip delta={move ?? 0} />
            </Link>
            <FollowButton type="player" targetId={p.id} variant="heart" size={14} />
          </div>
        )
      })}
    </div>
  )
}

'use client'
// src/app/[locale]/player/[id]/amateur/SummaryTab.tsx
// Widget grid for the amateur profile. Mirrors the pro Overview grid, minus
// everything the SNP source can't support (earnings, titles, per-point stats).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Widget, Last10SparkBar } from '../Widget'
import { PlaysWithCard, type PlaysWithRacket } from '../PlaysWithCard'
import { SuggestChangesSheet } from '@/components/SuggestChangesSheet'
import { ClaimProfileRow } from '@/components/ClaimProfileRow'
import type { AmateurProfileData } from '@/lib/amateur-profile'
import type { AmateurPlayer } from '../AmateurProfile'

const GREEN = '#7ED321'
const RED = '#FF4655'
const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'

export function SummaryTab({ player, data, racket }: { player: AmateurPlayer; data: AmateurProfileData; racket: PlaysWithRacket | null }) {
  const t = useTranslations('amateur')
  const [suggestOpen, setSuggestOpen] = useState(false)

  const { games, record, usualCourt, partners } = data
  const nameById = new Map(data.roster.map(r => [r.playerId, r.name]))
  const recordLabel = `${record.wins}–${record.losses}`

  return (
    <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

      {games.length > 0 && (
        <Widget label={t('lastGames', { count: games.length })} wide>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 52, marginTop: 4 }}>
            {games.map((g, i) => (
              <Last10SparkBar
                key={`${g.fixtureCode}-${i}`}
                won={g.result === 'W'}
                isLatest={i === games.length - 1}
                rowIndex={i}
                onClick={() => {}}
                title={`${g.fixtureCode} · ${g.result === 'W' ? t('won') : t('lost')}`}
                green={GREEN}
                red={RED}
                orange={ORANGE}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>
            <span>{games[0].fixtureCode}</span>
            <span>{games[games.length - 1].fixtureCode}</span>
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 5 }}>
            {t('lastGamesHint', { record: recordLabel })}
          </div>
        </Widget>
      )}

      {racket && <PlaysWithCard racket={racket} playerId={player.id} />}

      <Widget label={t('position')}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
          {player.side === 'drive' ? t('sideDrive') : player.side === 'backhand' ? t('sideBackhand') : '—'}
        </div>
      </Widget>

      {usualCourt && (
        <Widget label={t('usualCourt')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
            {t('usualCourtValue', { block: usualCourt.worth === 3 ? '1–2' : '3–5' })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('usualCourtHint', { count: usualCourt.count, total: usualCourt.total, worth: usualCourt.worth })}
          </div>
        </Widget>
      )}

      {record.winRate != null && (
        <Widget label={t('winRate')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {record.winRate}%
          </div>
          <div style={{ height: 4, background: '#242424', marginTop: 6 }}>
            <div style={{ width: `${record.winRate}%`, height: 4, background: GREEN }} />
          </div>
        </Widget>
      )}

      {data.competitionPoints != null && (
        <Widget label={t('competitionPoints', {
          competition: data.team.short_name ?? data.team.competition?.split('·')[0].trim() ?? '',
        })}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {Number(data.competitionPoints).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
          </div>
          {data.rosterRank != null && (
            <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
              {t('rosterRank', { rank: `${data.rosterRank}º` })}
            </div>
          )}
        </Widget>
      )}

      {data.nationalRank != null && (
        <Widget label={t('nationalRank')}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
            #{data.nationalRank}
          </div>
        </Widget>
      )}

      {(partners.confirmed.length > 0 || partners.probable.length > 0) && (
        <Widget label={t('partners')} wide>
          <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
            {partners.confirmed.map(id => (
              <span key={id} style={{ border: '1px solid #2A2A2A', padding: '3px 7px', fontSize: 10, color: '#fff' }}>
                {nameById.get(id) ?? id}
              </span>
            ))}
            {partners.probable.length > 0 && (
              <span style={{ border: '1px solid #2A2A2A', padding: '3px 7px', fontSize: 10, color: MUTED }}>
                {t('partnersProbable', { count: partners.probable.length })}
              </span>
            )}
          </div>
        </Widget>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, border: '1px dashed #2A2A2A', padding: '9px 10px' }}>
        <div style={{ flex: 1, fontSize: 10, color: MUTED }}>
          {t('suggestPrompt')}{' '}
          <button
            onClick={() => setSuggestOpen(true)}
            style={{ background: 'none', border: 'none', padding: 0, color: ORANGE, font: 'inherit', cursor: 'pointer' }}
          >
            {t('suggestCta')}
          </button>
        </div>
      </div>

      <ClaimProfileRow playerId={player.id} />

      {data.season.notes && (
        <div style={{ gridColumn: '1 / -1', background: '#141414', padding: '9px 10px' }}>
          <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
            {t('methodNote')}
          </div>
          <div style={{ fontSize: 9, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
        </div>
      )}

      <SuggestChangesSheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        player={{
          id: player.id,
          name: player.name,
          displayName: player.display_name?.trim() || player.name,
          country: player.country,
          birthplace: player.birthplace,
          birthdate: player.birthdate,
          height: player.height,
          hand: player.hand,
          side: player.side,
        }}
      />
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { isPremierTier } from '@/lib/tournament-tier'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { FLAG_KEYS } from '@/lib/feature-flags'
import type { ProjectionRow } from '@/lib/projection-types'
import { Widget } from './Widget'

const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const LIME = '#7ED321'
const MONO = 'ui-monospace, "SF Mono", monospace'

/** Shows the player's champion odds + a deep-link into the tournament Projection
 *  tab, when they're in an active Premier-tier tournament with a projection. */
export default function RoadToTrophyCard({
  playerId,
  tournamentId,
  tournamentLevel,
  category,
}: {
  playerId: string
  tournamentId: string
  tournamentLevel: string | null
  category: 'men' | 'women'
}) {
  const t = useTranslations('projectionTab')
  const router = useRouter()
  const projectionFlag = useFeatureFlag(FLAG_KEYS.PROJECTION_ENABLED)
  const [row, setRow] = useState<ProjectionRow | null>(null)

  useEffect(() => {
    if (!projectionFlag) return
    if (!isPremierTier(tournamentLevel ?? '')) return
    let cancelled = false
    supabase
      .from('tournament_projections')
      .select('pair_key, pair_player_ids, champion_prob, rounds, tournament_id, category')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .contains('pair_player_ids', [playerId])
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setRow(((data ?? [])[0] as ProjectionRow) ?? null)
      })
    return () => { cancelled = true }
  }, [playerId, tournamentId, tournamentLevel, category, projectionFlag])

  if (!row) return null

  const go = () => {
    router.push(`/tournaments/${tournamentId}?tab=projection&pair=${encodeURIComponent(row.pair_key)}&category=${category}` as Parameters<typeof router.push>[0])
  }

  return (
    <Widget wide label={t('cardTitle')}>
      <button onClick={go} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 2 }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ color: LIME, fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: MONO }}>{Math.round(row.champion_prob * 100)}%</div>
          <div style={{ color: MUTED, fontSize: 10, marginTop: 4 }}>{t('cardChampion', { pct: Math.round(row.champion_prob * 100) })}</div>
        </div>
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{t('cardCta')} ›</span>
      </button>
    </Widget>
  )
}

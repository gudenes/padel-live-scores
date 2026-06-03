// apps/ops/src/app/(app)/odds/calibration/page.tsx
// /odds/calibration — Brier/log-loss/favorite-hit-rate KPIs, per-tier + per-tournament
// breakdowns, and a model-freshness panel. Server component.

import { CalibrationKpiStrip } from '@/components/Odds/CalibrationKpiStrip'
import {
  CalibrationBreakdownTable,
  type CalibrationBreakdownRow,
} from '@/components/Odds/CalibrationBreakdownTable'
import { ModelFreshnessPanel } from '@/components/Odds/ModelFreshnessPanel'
import { PageHeader, Section } from '@/components/ui'
import {
  computeCalibrationKpis,
  getCalibrationData,
  getModelFreshness,
  type ScoredRow,
} from '@/lib/odds-data'
import { createServiceClient } from '@/lib/supabase'

export const metadata = { title: 'Calibration · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

// PostgREST embed types — `tournaments(level, name)` is returned either as a
// single object or null depending on the row. Typing this explicitly avoids `any`.
interface MatchMetaRow {
  id: string
  tournament_id: string
  tournaments: { level: string | null; name: string | null } | null
}

// Raw row shape from getCalibrationData — superset of ScoredRow (adds match_id +
// scored_at + model_version). Local alias keeps the .map call below typed.
interface CalibrationDataRow extends ScoredRow {
  match_id: string
  scored_at: string
  model_version: string
}

export default async function CalibrationPage() {
  const supabase = createServiceClient()
  const allRows = (await getCalibrationData(99_999)) as CalibrationDataRow[]
  const rows30d = (await getCalibrationData(30)) as CalibrationDataRow[]
  const freshness = await getModelFreshness()

  const allTime = computeCalibrationKpis(allRows)
  const last30d = computeCalibrationKpis(rows30d)

  // Per-tier + per-tournament breakdown: need to join through matches → tournaments → level.
  const matchIds = [...new Set(allRows.map((r) => r.match_id))]
  const matchMetaResult = matchIds.length
    ? await supabase
        .from('matches')
        .select('id, tournament_id, tournaments(level, name)')
        .in('id', matchIds)
    : { data: [] as MatchMetaRow[] }
  const matchMeta = (matchMetaResult.data ?? []) as unknown as MatchMetaRow[]

  const matchToLevel = new Map<string, string>()
  const matchToTournament = new Map<string, { id: string; name: string }>()
  for (const m of matchMeta) {
    const lvl = m.tournaments?.level ?? 'unknown'
    matchToLevel.set(m.id, lvl)
    matchToTournament.set(m.id, {
      id: m.tournament_id,
      name: m.tournaments?.name ?? 'Unknown',
    })
  }

  const byTier = new Map<string, CalibrationDataRow[]>()
  const byTournament = new Map<string, CalibrationDataRow[]>()
  for (const r of allRows) {
    const tier = matchToLevel.get(r.match_id) ?? 'unknown'
    const tourn = matchToTournament.get(r.match_id)
    if (!byTier.has(tier)) byTier.set(tier, [])
    byTier.get(tier)!.push(r)
    if (tourn) {
      const k = `${tourn.id}::${tourn.name}`
      if (!byTournament.has(k)) byTournament.set(k, [])
      byTournament.get(k)!.push(r)
    }
  }

  const tierRows: CalibrationBreakdownRow[] = [...byTier.entries()]
    .map(([k, rows]) => {
      const k0 = computeCalibrationKpis(rows)
      return {
        key: k,
        count: k0.totalScored,
        meanBrier: k0.meanBrier ?? 0,
        meanLogLoss: k0.meanLogLoss ?? 0,
        favoriteHitRate: k0.favoriteHitRate ?? 0,
      }
    })
    .sort((a, b) => b.count - a.count)

  const tournRows: CalibrationBreakdownRow[] = [...byTournament.entries()]
    .map(([k, rows]) => {
      const parts = k.split('::')
      const name = parts[1] ?? 'Unknown'
      const k0 = computeCalibrationKpis(rows)
      return {
        key: name,
        count: k0.totalScored,
        meanBrier: k0.meanBrier ?? 0,
        meanLogLoss: k0.meanLogLoss ?? 0,
        favoriteHitRate: k0.favoriteHitRate ?? 0,
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return (
    <div className="ui-page">
      <PageHeader title="Calibration" />

      <CalibrationKpiStrip
        windowLabel='30d'
        totalScored={last30d.totalScored}
        meanBrier={last30d.meanBrier}
        meanLogLoss={last30d.meanLogLoss}
        favoriteHitRate={last30d.favoriteHitRate}
      />

      <CalibrationBreakdownTable title='By tier' rows={tierRows} />
      <CalibrationBreakdownTable title='By tournament (last 10)' rows={tournRows} />

      <Section label="Model freshness">
        <ModelFreshnessPanel
          snapshotAgeMin={freshness.snapshotAgeMin}
          trainingMatchCount={freshness.trainingMatchCount}
          modelVersion={freshness.modelVersion}
          unscoredFinishedLast7d={freshness.unscoredFinishedLast7d}
          meanBrier30d={last30d.meanBrier}
          favoriteHitRate30d={last30d.favoriteHitRate}
        />
      </Section>

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--text-3)' }}>
        Showing {allTime.totalScored.toLocaleString()} scored predictions all-time.
      </div>
    </div>
  )
}

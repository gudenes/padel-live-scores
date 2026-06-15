import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo-helpers'
import {
  isProjectionEnabledServer,
  fetchProjectionRows,
  fetchProjectionCategories,
  fetchPlayerNames,
  fetchProjectionTournamentMeta,
  type ProjectionCategory,
} from '@/lib/projection-server'
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
import type { ProjectionRow } from '@/lib/projection-types'
import { TournamentProjectionHeader } from '@/components/tournament/TournamentProjectionHeader'
import { ProjectionSeoBlock } from '../ProjectionSeoBlock'
import ProjectionRouteClient from '../ProjectionRouteClient'

const DRAW_TIERS = new Set(['major', 'p1', 'p2', 'finals', 'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum'])

type Props = {
  params: Promise<{ locale: string; id: string; pair: string }>
}

async function resolvePairAcrossCategories(id: string, pairSlug: string): Promise<{
  row: ProjectionRow
  category: ProjectionCategory
  rows: ProjectionRow[]
  nameById: Map<string, string>
  canonicalSlug: string
  redirect: boolean
} | null> {
  const categories = await fetchProjectionCategories(id)
  for (const category of categories) {
    const rows = await fetchProjectionRows(id, category)
    if (rows.length === 0) continue
    const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))
    const index = buildSlugIndex(rows, nameById)
    const resolved = resolvePairSlug(index, pairSlug)
    if (resolved) {
      const row = rows.find((r) => r.pair_key === resolved.pairKey)
      if (row) return { row, category, rows, nameById, canonicalSlug: resolved.canonicalSlug, redirect: resolved.redirect }
    }
  }
  return null
}

function pairTitle(row: ProjectionRow, nameById: Map<string, string>): string {
  return row.pair_player_ids
    .map((pid) => {
      const full = nameById.get(pid) ?? pid
      const tk = full.trim().split(/\s+/)
      return tk[tk.length - 1] || full
    })
    .join(' / ')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, pair, locale } = await params
  const meta = await fetchProjectionTournamentMeta(id)
  const resolved = await resolvePairAcrossCategories(id, pair)

  if (!meta || !meta.name || !resolved) {
    return { title: 'Projection | Padel Nachos', robots: { index: false, follow: false } }
  }

  const t = await getTranslations({ locale, namespace: 'seo.projection' })
  const pairName = pairTitle(resolved.row, resolved.nameById)
  const title = t('pairTitle', { pair: pairName, name: meta.name })
  const description = t('pairDescription', { pair: pairName, name: meta.name })
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title },
    ...buildAlternates(`/tournaments/${id}/projection/${resolved.canonicalSlug}`, locale),
  }
}

export default async function ProjectionPairPage({ params }: Props) {
  const { id, pair } = await params

  if (!(await isProjectionEnabledServer())) notFound()

  const meta = await fetchProjectionTournamentMeta(id)
  if (!meta || !meta.name) notFound()

  const resolved = await resolvePairAcrossCategories(id, pair)
  if (!resolved) notFound()

  if (resolved.redirect) {
    permanentRedirect(`/tournaments/${id}/projection/${resolved.canonicalSlug}`)
  }

  const { pairKeyToSlug } = buildSlugIndex(resolved.rows, resolved.nameById)
  const showDrawTab = DRAW_TIERS.has(meta.level ?? '')

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <main style={{ maxWidth: 500, margin: '0 auto', background: '#1A1A1A', minHeight: '100vh' }}>
        <TournamentProjectionHeader tournament={meta} category={resolved.category} />
        <ProjectionSeoBlock
          tournamentName={meta.name}
          category={resolved.category}
          rows={resolved.rows}
          nameById={resolved.nameById}
          pairKey={resolved.row.pair_key}
        />
        <ProjectionRouteClient
          tournamentId={id}
          category={resolved.category}
          initialPairKey={resolved.row.pair_key}
          tournamentLevel={meta.level}
          roundSchedule={meta.round_schedule}
          pairKeyToSlug={Object.fromEntries(pairKeyToSlug)}
          showDrawTab={showDrawTab}
        />
      </main>
    </div>
  )
}

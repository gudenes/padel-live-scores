import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
import { buildSlugIndex } from '@/lib/projection-slug'
import { TournamentProjectionHeader } from '@/components/tournament/TournamentProjectionHeader'
import { ProjectionSeoBlock } from './ProjectionSeoBlock'
import ProjectionRouteClient from './ProjectionRouteClient'

const DRAW_TIERS = new Set(['major', 'p1', 'p2', 'finals', 'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum'])

type Props = {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ category?: string }>
}

async function resolveCategory(id: string, raw: string | undefined): Promise<ProjectionCategory | null> {
  const available = await fetchProjectionCategories(id)
  if (available.length === 0) return null
  if (raw === 'women' && available.includes('women')) return 'women'
  if (raw === 'men' && available.includes('men')) return 'men'
  return available[0]  // default: men first when both present
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id, locale } = await params
  const { category: rawCategory } = await searchParams
  const meta = await fetchProjectionTournamentMeta(id)
  const category = await resolveCategory(id, rawCategory)

  if (!meta || !meta.name || !category) {
    return { title: 'Projection | Padel Nachos', robots: { index: false, follow: false } }
  }

  const t = await getTranslations({ locale, namespace: 'seo.projection' })
  const title = t('title', { name: meta.name })
  const description = t('description', { name: meta.name })
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title },
    ...buildAlternates(`/tournaments/${id}/projection`, locale),
  }
}

export default async function ProjectionPage({ params, searchParams }: Props) {
  const { id } = await params
  const { category: rawCategory } = await searchParams

  if (!(await isProjectionEnabledServer())) notFound()

  const meta = await fetchProjectionTournamentMeta(id)
  const category = await resolveCategory(id, rawCategory)
  if (!meta || !meta.name) notFound()

  const rows = category ? await fetchProjectionRows(id, category) : []
  const resolvedCategory: ProjectionCategory = category ?? 'men'
  const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))
  const { pairKeyToSlug } = buildSlugIndex(rows, nameById)
  const showDrawTab = DRAW_TIERS.has(meta.level ?? '')

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <main style={{ maxWidth: 500, margin: '0 auto', background: '#1A1A1A', minHeight: '100vh' }}>
        <TournamentProjectionHeader tournament={meta} category={resolvedCategory} />
        <ProjectionSeoBlock
          tournamentName={meta.name}
          category={resolvedCategory}
          rows={rows}
          nameById={nameById}
        />
        <ProjectionRouteClient
          tournamentId={id}
          category={resolvedCategory}
          initialPairKey={null}
          tournamentLevel={meta.level}
          roundSchedule={meta.round_schedule}
          pairKeyToSlug={Object.fromEntries(pairKeyToSlug)}
          showDrawTab={showDrawTab}
        />
      </main>
    </div>
  )
}

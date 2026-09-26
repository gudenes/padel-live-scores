// apps/ops/src/app/(app)/teams/[id]/page.tsx
import { notFound } from 'next/navigation'
import { serviceClient } from '@/lib/supabase'
import { PageHeader, Panel } from '@/components/ui'
import TeamEditor, { type EditableTeam } from './TeamEditor'

export const dynamic = 'force-dynamic'

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data } = await serviceClient()
    .from('teams')
    .select('id, name, badge_label, short_name, city, country, crest_url, cover_image_url')
    .eq('id', id)
    .single()

  if (!data) notFound()

  return (
    <div className="ui-page">
      <PageHeader title={data.name} />
      <Panel>
        <TeamEditor team={data as unknown as EditableTeam} />
      </Panel>
    </div>
  )
}

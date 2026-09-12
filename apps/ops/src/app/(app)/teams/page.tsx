// apps/ops/src/app/(app)/teams/page.tsx
// Team list. Read-only: teams are created by the season import, never here.

import Link from 'next/link'
import { serviceClient } from '@/lib/supabase'
import { PageHeader, Panel } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  const { data: teams } = await serviceClient()
    .from('teams')
    .select('id, name, slug, competition, city')
    .order('name')

  return (
    <div className="ui-page">
      <PageHeader title="Teams" />
      <Panel>
        {(teams ?? []).length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 14, padding: 12 }}>
            No teams yet — they arrive with the season import.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--border-card)' }}>
            {(teams ?? []).map(t => (
              <Link
                key={t.id}
                href={`/teams/${t.id}`}
                style={{
                  background: 'var(--bg-card)', padding: '12px 14px',
                  textDecoration: 'none', color: 'inherit', display: 'grid', gap: 2,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{t.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {[t.competition, t.city].filter(Boolean).join(' · ') || t.slug}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

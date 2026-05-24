import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface TrendRow { source_id: string; key: string; name: string; daily: number[] }

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pgPool().query<{ source_id: string; key: string; name: string; day: string; n: number }>(
    `
    WITH top10 AS (
      SELECT id, key, name FROM news_sources WHERE enabled = true
       ORDER BY articles_last_7d DESC LIMIT 10
    ),
    days AS (
      SELECT generate_series((now() - interval '29 days')::date, now()::date, interval '1 day')::date AS day
    )
    SELECT t.id AS source_id, t.key, t.name, d.day::text AS day,
           COALESCE(count(a.id), 0)::int AS n
    FROM top10 t
    CROSS JOIN days d
    LEFT JOIN articles a ON a.source_id = t.id AND a.published_at::date = d.day
    GROUP BY t.id, t.key, t.name, d.day
    ORDER BY t.key, d.day
    `,
  )

  const map = new Map<string, TrendRow>()
  for (const r of rows) {
    if (!map.has(r.source_id)) map.set(r.source_id, { source_id: r.source_id, key: r.key, name: r.name, daily: [] })
    map.get(r.source_id)!.daily.push(r.n)
  }
  return NextResponse.json({ trends: [...map.values()] })
}

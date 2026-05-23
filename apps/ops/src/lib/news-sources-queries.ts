// apps/ops/src/lib/news-sources-queries.ts
import { pgPool } from './db'

export interface NewsSourceRow {
  id: string
  key: string
  name: string
  url: string
  source_type: string
  language: string
  weight: number
  lookback_days: number
  cadence: string
  query_kind: string | null
  query_entity_id: string | null
  enabled: boolean
  created_at: string
  created_by: string | null
  notes: string | null
  last_fetch_at: string | null
  last_fetch_status: string | null
  last_fetch_error: string | null
  articles_last_7d: number
}

export async function listNewsSources(): Promise<NewsSourceRow[]> {
  const { rows } = await pgPool().query<NewsSourceRow>(`
    SELECT id, key, name, url, source_type, language, weight, lookback_days,
           cadence, query_kind, query_entity_id, enabled, created_at, created_by,
           notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d
    FROM news_sources
    ORDER BY articles_last_7d DESC, key ASC
  `)
  return rows
}

export interface CreateNewsSourceInput {
  key: string
  name: string
  url: string
  source_type: string
  language: string
  cadence: string
  weight?: number
  lookback_days?: number
  query_kind?: string
  notes?: string
  enabled?: boolean
  created_by: string
}

export async function createNewsSource(input: CreateNewsSourceInput): Promise<NewsSourceRow> {
  const { rows } = await pgPool().query<NewsSourceRow>(`
    INSERT INTO news_sources (
      key, name, url, source_type, language, weight, lookback_days, cadence,
      query_kind, enabled, created_by, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, key, name, url, source_type, language, weight, lookback_days,
              cadence, query_kind, query_entity_id, enabled, created_at, created_by,
              notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d
  `, [
    input.key,
    input.name,
    input.url,
    input.source_type,
    input.language,
    input.weight ?? 1.0,
    input.lookback_days ?? 14,
    input.cadence,
    input.query_kind ?? 'static',
    input.enabled ?? true,
    input.created_by,
    input.notes ?? null,
  ])
  return rows[0]
}

export interface UpdateNewsSourceInput {
  id: string
  name?: string
  url?: string
  weight?: number
  lookback_days?: number
  enabled?: boolean
  notes?: string
}

export async function updateNewsSource(input: UpdateNewsSourceInput): Promise<NewsSourceRow | null> {
  // Build SET clause dynamically from non-undefined keys.
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id') continue
    if (value === undefined) continue
    fields.push(`${key} = $${i++}`)
    values.push(value)
  }
  if (fields.length === 0) {
    // No-op update — just return the row.
    const { rows } = await pgPool().query<NewsSourceRow>(
      `SELECT * FROM news_sources WHERE id = $1`,
      [input.id],
    )
    return rows[0] ?? null
  }
  values.push(input.id)
  const { rows } = await pgPool().query<NewsSourceRow>(`
    UPDATE news_sources SET ${fields.join(', ')}
    WHERE id = $${i}
    RETURNING id, key, name, url, source_type, language, weight, lookback_days,
              cadence, query_kind, query_entity_id, enabled, created_at, created_by,
              notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d
  `, values)
  return rows[0] ?? null
}

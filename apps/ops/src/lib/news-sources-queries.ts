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
  extraction_quality_pct: number | null
  auto_disabled_at: string | null
}

export async function listNewsSources(): Promise<NewsSourceRow[]> {
  const { rows } = await pgPool().query<NewsSourceRow>(`
    SELECT id, key, name, url, source_type, language, weight, lookback_days,
           cadence, query_kind, query_entity_id, enabled, created_at, created_by,
           notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d,
           extraction_quality_pct, auto_disabled_at
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
              notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d,
              extraction_quality_pct, auto_disabled_at
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
  language?: string
  weight?: number
  cadence?: string
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
              notes, last_fetch_at, last_fetch_status, last_fetch_error, articles_last_7d,
              extraction_quality_pct, auto_disabled_at
  `, values)
  return rows[0] ?? null
}

export async function deleteNewsSource(id: string): Promise<boolean> {
  const { rowCount } = await pgPool().query(
    `DELETE FROM news_sources WHERE id = $1`,
    [id],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Slug-ify a name into a unique key. Falls back to host + counter on collision.
 * Used by AddSourceDrawer to suggest a key from the detected name.
 */
export async function suggestUniqueKey(seed: string): Promise<string> {
  const base = seed.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'source'
  let candidate = base
  for (let i = 2; i < 100; i++) {
    const { rows } = await pgPool().query<{ id: string }>(
      `SELECT id FROM news_sources WHERE key = $1 LIMIT 1`, [candidate],
    )
    if (rows.length === 0) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

/**
 * Mark a suggestion as approved and link it to the newly created news_source.
 * Called after createNewsSource when POST /api/news-sources receives from_suggestion_id.
 */
export async function approveSuggestionWithSource(suggestionId: string, sourceId: string, reviewer: string): Promise<void> {
  await pgPool().query(
    `UPDATE news_source_suggestions
       SET status = 'approved',
           approved_source_id = $1,
           reviewed_by = $2,
           reviewed_at = now()
     WHERE id = $3`,
    [sourceId, reviewer, suggestionId],
  )
}

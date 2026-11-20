import { pgPool } from '@/lib/db'
import type { HistoryRow, IntegrationHistory } from './integration-history'

// Return aggregates only: upstream URLs and raw errors may contain credentials.
export async function loadIntegrationHistory(hours: 24 | 168): Promise<IntegrationHistory> {
  const client = await pgPool().connect()
  const fetchedAt = new Date().toISOString()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '8s'")
    const rows: HistoryRow[] = []
    // Day-sized indexed reads avoid a week-wide sequential scan of the job log.
    for (let offset = 0; offset < hours; offset += 24) {
      const end = offset === 0 ? fetchedAt : new Date(Math.floor(Date.parse(fetchedAt) / 3600000) * 3600000 - (offset - 1) * 3600000 - 1).toISOString()
      const result = await client.query<HistoryRow>(`
      select date_trunc('hour', started_at at time zone 'UTC')::text || 'Z' as hour,
        case when target_url like 'https://www.padelfip.com/%' then 'fip' else 'crionet' end as feed,
        job_type as job, status,
        case when status <> 'failed' then null
          when error_message ~* '403|forbidden|cloudflare' then 'Access blocked / HTTP 403'
          when error_message ~* '429|rate.limit' then 'Rate limited / HTTP 429'
          when error_message ~* 'timeout|timed out|abort' then 'Timeout'
          when error_message ~* '502|503|504|500' then 'Upstream server error'
          when error_message ~* 'parse|zero.rows|invalid.json' then 'Parsing / empty data'
          when error_message ~* 'ENOTFOUND|ECONN|network|socket|fetch failed' then 'Network / connection'
          else 'Other / unclassified' end as reason,
        count(*)::int as runs,
        coalesce(sum(duration_ms) filter(where status in ('success','failed')),0)::float as duration_total,
        count(duration_ms) filter(where status in ('success','failed'))::int as duration_count,
        max(started_at)::text as latest
      from padelgod.scrape_jobs
      where started_at >= date_trunc('hour', $1::timestamptz) - (($2::int - 1) * interval '1 hour')
        and started_at <= $1::timestamptz
        and (target_url like 'https://www.padelfip.com/%' or target_url like 'https://widget.matchscorerlive.com/%')
      group by 1,2,3,4,5 order by 1,2,3,4,5`, [end, 24])
      rows.push(...result.rows)
    }
    await client.query('COMMIT')
    return { fetchedAt, hours, rows }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

// Read-only prospective validation. Samples each match once near its start, so
// matches with more minute-by-minute forecasts do not dominate the metric.
import pg from 'pg'
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const { rows } = await client.query(`
    with eligible as (
      select distinct on (m.id) m.id, m.started_at, m.scheduled_at,
        o.earliest_at, o.latest_at, o.computed_at
      from public.match_schedule_forecast_observations o
      join public.matches m on m.id=o.match_id
      where m.status='finished' and m.started_at is not null and m.duration is not null
        and m.last_updated_by='padelgod'
        and o.computed_at < m.started_at - interval '10 minutes'
        and o.computed_at >= m.started_at - interval '2 hours'
      order by m.id, o.computed_at desc
    )
    select count(*)::int samples,
      round(100.0 * count(*) filter (where started_at between earliest_at and latest_at) / nullif(count(*),0),1) window_coverage_pct,
      percentile_cont(.5) within group (order by abs(extract(epoch from (started_at-(earliest_at+(latest_at-earliest_at)/2))))/60) median_forecast_error_min,
      percentile_cont(.5) within group (order by abs(extract(epoch from (started_at-scheduled_at)))/60) median_schedule_error_min
    from eligible
  `)
  console.log(JSON.stringify(rows[0], null, 2))
  await client.query('ROLLBACK')
} finally { await client.end() }

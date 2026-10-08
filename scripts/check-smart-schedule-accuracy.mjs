// Read-only prospective validation. One sample per match/model/horizon so minute
// ticks do not overweight slower matches. Compatible before/after calibration migration.
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query(`with candidate as (
 select m.id,m.started_at,
 coalesce((to_jsonb(o)->>'scheduled_at_snapshot')::timestamptz,m.scheduled_at) scheduled_at,
 to_jsonb(o)->>'scheduled_at_snapshot' is not null captured_schedule,
 coalesce(to_jsonb(o)->>'model','court-progress-v1') model,
 coalesce(to_jsonb(o)->>'next_to_play','unknown') next_to_play,
 o.earliest_at,o.latest_at,o.computed_at,o.basis,
 case when o.computed_at>=m.started_at-interval '30 minutes' then '10–30 min'
 when o.computed_at>=m.started_at-interval '60 minutes' then '30–60 min' else '60–120 min' end horizon
 from public.match_schedule_forecast_observations o join public.matches m on m.id=o.match_id
 where m.status='finished' and m.started_at is not null and m.duration is not null and m.last_updated_by='padelgod'
 and o.computed_at<m.started_at-interval '10 minutes' and o.computed_at>=m.started_at-interval '2 hours'
 ), eligible as (
 select distinct on(id,model,horizon) * from candidate order by id,model,horizon,computed_at desc
 )
 select model,basis,next_to_play,horizon,count(*)::int samples,
 round(100.0*count(*) filter(where started_at between earliest_at and latest_at)/nullif(count(*),0),1) window_coverage_pct,
 percentile_cont(.5) within group(order by abs(extract(epoch from (started_at-(earliest_at+(latest_at-earliest_at)/2))))/60) median_forecast_error_min,
 percentile_cont(.5) within group(order by abs(extract(epoch from (started_at-scheduled_at)))/60) median_schedule_error_min,
 count(*) filter(where captured_schedule)::int samples_with_captured_schedule
 from eligible group by model,basis,next_to_play,horizon order by model,horizon,basis,next_to_play`);
  console.log(JSON.stringify(rows, null, 2));
  await client.query("ROLLBACK");
} finally {
  await client.end();
}

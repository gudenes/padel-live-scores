import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

export interface ReportAccessRow {
  match_id: string; manual: boolean; tournament: string | null; players: string[];
  links: number; requests: number; verified: number; viewers: number; opens: number; last_open: string | null
}
export interface ReportVisitorRow {
  match_id: string; manual: boolean; email: string; event: string; created_at: string
}
export async function getReportAccess(days = 30) {
  if (!(await auth())?.user?.isOperator) return null
  try {
    const db = pgPool()
    const reports = await db.query<ReportAccessRow>(`
      with activity as (
        select * from report_share_activity where created_at >= now() - $1::int * interval '1 day'
      )
      select s.match_id, bool_or(m.id is not null) as manual,
        max(s.snapshot->'meta'->>'tournament') as tournament,
        (array_agg(s.snapshot->'players' order by s.created_at desc))[1] as players,
        count(distinct s.token_hash)::int as links,
        count(a.id) filter(where a.event='code_requested')::int as requests,
        count(distinct lower(a.email)) filter(where a.event='verified')::int as verified,
        count(distinct lower(a.email)) filter(where a.event='report_viewed')::int as viewers,
        count(a.id) filter(where a.event='report_viewed')::int as opens,
        max(a.created_at) filter(where a.event='report_viewed') as last_open
      from scouting_report_shares s
      left join activity a on a.share_hash=s.token_hash
      left join operator_manual_scouting_matches m on m.id=s.match_id
      group by s.match_id
      having max(s.created_at) >= now() - $1::int * interval '1 day' or count(a.id)>0
      order by max(a.created_at) desc nulls last, max(s.created_at) desc
      limit 100`, [days])
    const activity = await db.query<ReportVisitorRow>(`
      select s.match_id,m.id is not null as manual,a.email,a.event,a.created_at
      from report_share_activity a join scouting_report_shares s on s.token_hash=a.share_hash
      left join operator_manual_scouting_matches m on m.id=s.match_id
      where a.created_at >= now() - $1::int * interval '1 day'
      order by a.created_at desc,a.id desc limit 100`, [days])
    return { reports: reports.rows.map(r => ({...r, players: (r.players as unknown as {name?:string}[] ?? []).map(p=>p.name || 'Player')})), activity: activity.rows }
  } catch {
    return null // An unavailable audit log must not look like zero engagement.
  }
}

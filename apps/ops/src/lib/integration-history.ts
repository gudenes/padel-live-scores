export type HistoryFeed = 'fip' | 'crionet'
export interface HistoryRow {
  hour: string; feed: HistoryFeed; job: string; status: string; reason: string | null
  runs: number; duration_total: number; duration_count: number; latest: string
}
export interface HistoryPoint { hour: string; success: number; failed: number; pending: number; failureRate: number | null; averageMs: number | null }
export function historyPoints(rows: HistoryRow[], feed: HistoryFeed, hours: number, end: string): HistoryPoint[] {
  const endHour = Math.floor(Date.parse(end) / 3600000) * 3600000
  const buckets = new Map<string, HistoryRow[]>()
  for (const row of rows.filter(r => r.feed === feed)) {
    const key = new Date(row.hour).toISOString()
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return Array.from({length: hours}, (_, i) => {
    const hour = new Date(endHour - (hours - 1 - i) * 3600000).toISOString()
    const group = buckets.get(hour) ?? []
    const count = (status: string) => group.filter(r => r.status === status).reduce((n,r) => n+r.runs,0)
    const success=count('success'), failed=count('failed'), pending=count('running')+count('queued')
    const durationCount=group.reduce((n,r)=>n+r.duration_count,0)
    return {hour,success,failed,pending,failureRate:success+failed ? failed/(success+failed)*100 : null,averageMs:durationCount ? group.reduce((n,r)=>n+r.duration_total,0)/durationCount : null}
  })
}
export interface IntegrationHistory { fetchedAt: string; hours: number; rows: HistoryRow[] }

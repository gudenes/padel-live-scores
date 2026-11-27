import { liveRaceHealth } from '@/lib/live-race-health'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { feedHealth, monitorSnapshot, type IntegrationMonitor } from '@/lib/integration-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 20
let cached: { at: number; data: IntegrationMonitor } | null = null
let pending: Promise<IntegrationMonitor> | null = null

async function load(): Promise<IntegrationMonitor> {
  const now = Date.now()
  const health = async () => {
    // Server-owned URL, never a caller-provided proxy target. /health requires no credential.
    const base = process.env.PADELGOD_HEALTH_URL ?? 'https://padel-live-scores-production-4189.up.railway.app/health'
    const response = await fetch(base, { cache: 'no-store', signal: AbortSignal.timeout(6000), redirect: 'error' })
    if (!response.ok) throw new Error('Worker unavailable')
    return response.json()
  }
  const feed = async (id: string, name: string, host: string) => {
    try {
      const db = serviceClient()
      const since = new Date(now - 86_400_000).toISOString()
      const query = () => db.schema('padelgod').from('scrape_jobs').select('*', { count: 'exact', head: true }).like('target_url', `https://${host}/%`).gte('started_at', since).neq('status', 'running')
      const [runs, failures, latest] = await Promise.all([
        query().abortSignal(AbortSignal.timeout(8000)),
        query().eq('status', 'failed').abortSignal(AbortSignal.timeout(8000)),
        db.schema('padelgod').from('scrape_jobs').select('started_at,status').like('target_url', `https://${host}/%`).gte('started_at', since).neq('status','running').order('started_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle(),
      ])
      if (runs.error || failures.error || latest.error) throw new Error('History unavailable')
      return feedHealth(id, name, runs.count, failures.count, latest.data?.started_at ?? null, latest.data?.status === 'failed', now)
    } catch { return feedHealth(id, name, null, null, null, false, now) }
  }
  const race = async () => {
    try { const result=await serviceClient().rpc('live_race_health').abortSignal(AbortSignal.timeout(8000));return result.error?null:result.data } catch {return null}
  }
  const [worker, fip, crionet, live] = await Promise.allSettled([health(), feed('fip', 'FIP ingestion', 'www.padelfip.com'), feed('crionet', 'Crionet ingestion', 'widget.matchscorerlive.com'), race()])
  const feeds = [fip, crionet].flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  return {...monitorSnapshot(worker.status === 'fulfilled' ? worker.value : null, feeds, Date.now()),liveRace:liveRaceHealth(live.status==='fulfilled'?live.value:null)}
}
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!cached || Date.now() - cached.at >= 30_000) {
    pending ??= load().then(data => { cached = { at: Date.now(), data }; return data }).finally(() => { pending = null })
    await pending
  }
  return NextResponse.json(cached!.data, { headers: { 'Cache-Control': 'private, no-store' } })
}

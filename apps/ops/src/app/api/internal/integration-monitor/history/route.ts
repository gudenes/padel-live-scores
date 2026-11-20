import { auth } from '@/lib/auth'
import { loadIntegrationHistory } from '@/lib/integration-history-source'
import type { IntegrationHistory } from '@/lib/integration-history'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
const cache = new Map<number, { at: number; data: IntegrationHistory }>()
const pending = new Map<number, Promise<IntegrationHistory>>()
export async function GET(request: Request) {
  if (!(await auth())?.user?.isOperator) return Response.json({error:'unauthorized'},{status:401})
  const range = new URL(request.url).searchParams.get('range') ?? '24h'
  if (range !== '24h' && range !== '7d') return Response.json({error:'Invalid range'},{status:400})
  const hours = range === '7d' ? 168 : 24
  try {
    let entry = cache.get(hours)
    if (!entry || Date.now()-entry.at > (hours === 168 ? 300000 : 60000)) {
      let task = pending.get(hours)
      if (!task) {
        task = loadIntegrationHistory(hours).then(data => {cache.set(hours,{at:Date.now(),data});return data}).finally(()=>pending.delete(hours))
        pending.set(hours,task)
      }
      await task
      entry = cache.get(hours)!
    }
    return Response.json(entry.data,{headers:{'Cache-Control':'private, no-store'}})
  } catch { return Response.json({error:'Ingestion history is unavailable. Retry shortly.'},{status:503}) }
}

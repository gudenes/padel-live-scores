import { createServiceClient } from '@/lib/supabase'
import { dispatchPlayResultPushes } from '@/lib/play-result-push'

export async function GET(req: Request) {
 if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
 }
 if (process.env.PLAY_RESULT_PUSH_ENABLED !== 'true') return Response.json({ enabled: false })
 try {
  return Response.json(await dispatchPlayResultPushes(createServiceClient()))
 } catch (error) {
  console.error('[play-result-push]', error instanceof Error ? error.message : 'dispatch failed')
  return Response.json({ error: 'Dispatch failed' }, { status: 503 })
 }
}

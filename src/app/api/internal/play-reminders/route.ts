import { timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase'
import {
  runPlayReminders,
  productionEmail,
  pushContent,
} from '@/lib/play-reminders/run'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET,
    received = req.headers.get('authorization') ?? '',
    expected = `Bearer ${secret}`
  const supplied = Buffer.from(received),
    wanted = Buffer.from(expected)
  if (
    !secret ||
    supplied.length !== wanted.length ||
    !timingSafeEqual(supplied, wanted)
  )
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  const mode = process.env.PLAY_REMINDERS_MODE ?? 'off'
  if (mode !== 'live' && mode !== 'dry-run')
    return Response.json({ enabled: false })
  const body = await req.json().catch(() => ({})),
    dryRun = mode !== 'live' || body?.dryRun === true,
    db = createServiceClient()
  try {
    const result = await runPlayReminders(
      db,
      {
        email: productionEmail,
        push: async (userId, payload, key) => {
          const [web, native] = await Promise.all([
            db
              .from('push_subscriptions')
              .select('endpoint,keys')
              .eq('user_id', userId),
            db
              .from('native_push_subscriptions')
              .select('device_token')
              .eq('user_id', userId),
          ])
          if (web.error || native.error)
            throw Error('subscriptions_unavailable')
          const expiresAt = Math.min(
            ...payload.matches.flatMap((m) => [
              Date.parse(m.startsAt),
              Date.parse(m.locksAt),
            ])
          )
          const ttlSeconds = Math.max(
            0,
            Math.floor((expiresAt - Date.now()) / 1000)
          )
          if (ttlSeconds === 0) return false
          const content = { ...pushContent(payload, key), ttlSeconds }
          let accepted = 0
          // Lazy imports let email/dry runs work without mobile credentials.
          if (web.data?.length) {
            const { sendPush } = await import('@/lib/push')
            for (const sub of web.data)
              if (await sendPush(sub, content, { ttlSeconds })) accepted++
          }
          if (native.data?.length) {
            const { sendPushToFcmTokens } = await import('@/lib/push-fcm')
            const r = await sendPushToFcmTokens(
              native.data.map((s) => s.device_token),
              content
            )
            accepted += r.success
            if (r.invalidTokens.length)
              await db
                .from('native_push_subscriptions')
                .delete()
                .in('device_token', r.invalidTokens)
                .eq('user_id', userId)
          }
          return accepted > 0
        },
      },
      { dryRun }
    )
    return Response.json(result, { status: result.failed ? 503 : 200 })
  } catch (e) {
    console.error('[play-reminders]', e instanceof Error ? e.message : 'failed')
    return Response.json({ error: 'reminders_unavailable' }, { status: 503 })
  }
}

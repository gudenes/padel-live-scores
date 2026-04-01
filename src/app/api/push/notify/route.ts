// src/app/api/push/notify/route.ts
// Internal endpoint: sends push notifications for a match going live.
// Protected by CRON_SECRET. Called by the score cron when a match transitions to live.

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { matchId } = await request.json()
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  // Fetch match details for notification content
  const { data: match } = await supabase
    .from('matches')
    .select(`
      id, round,
      tournament:tournaments(name),
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('id', matchId)
    .single()

  if (!match) {
    return Response.json({ error: 'Match not found' }, { status: 404 })
  }

  // Find users who bookmarked this match
  const { data: bookmarks } = await supabase
    .from('user_bookmarks')
    .select('user_id')
    .eq('bookmark_type', 'match')
    .eq('target_id', matchId)

  if (!bookmarks?.length) {
    return Response.json({ ok: true, sent: 0 })
  }

  const userIds = bookmarks.map(b => b.user_id)

  // Get push subscriptions for those users
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .in('user_id', userIds)

  if (!subscriptions?.length) {
    return Response.json({ ok: true, sent: 0 })
  }

  // Build notification payload
  const m = match as any
  const team1 = [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).map((n: string) => n.split(' ').pop()).join('/')
  const team2 = [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).map((n: string) => n.split(' ').pop()).join('/')
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''

  const payload = {
    title: 'Match is Live! 🟢',
    body: `${team1} vs ${team2} — ${tournament}${round ? ` ${round}` : ''}`,
    url: `/match/${matchId}`,
    tag: `match-${matchId}`,
  }

  // Send to all subscriptions, delete stale ones
  let sent = 0
  const staleIds: string[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const success = await sendPush(
        { endpoint: sub.endpoint, keys: sub.keys as any },
        payload
      )
      if (success) {
        sent++
      } else {
        staleIds.push(sub.id)
      }
    })
  )

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', staleIds)
    console.log(`[Push] Cleaned ${staleIds.length} stale subscriptions`)
  }

  console.log(`[Push] Sent ${sent} notifications for match ${matchId}`)
  return Response.json({ ok: true, sent, stale_cleaned: staleIds.length })
}

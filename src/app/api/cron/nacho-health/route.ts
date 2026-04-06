// src/app/api/cron/nacho-health/route.ts
// Scheduled daily health report — triggers NachoWatch agent and sends to Telegram.
// Runs daily at 7:00 AM UTC via Vercel cron.

import { NextRequest } from 'next/server'
import { runAgent } from '@/app/api/qa-bot/route'
import { sendMessage, getDefaultChatId } from '@/lib/nacho-watch/telegram'
import { logOpsEvent } from '@/lib/ops-logger'

export async function GET(request: NextRequest) {
  // Auth check (same pattern as other crons)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const meta = await logOpsEvent('cron:nacho-health', async () => {
    const chatId = getDefaultChatId()

    // Run the agent with a health report prompt
    const { text, tokensUsed } = await runAgent(
      'Give me today\'s full health report. Check all systems: relay, live matches, stale matches, cron jobs, rate limits, and data quality.'
    )

    // Send to Telegram
    const header = '📊 *Daily Health Report*\n\n'
    const footer = `\n\n_Auto-report | ${tokensUsed} tokens_`
    await sendMessage(chatId, header + text + footer)

    return { tokensUsed, messageLength: text.length }
  })

  return Response.json({ ok: true, ...meta })
}

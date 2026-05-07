// apps/labs/src/app/api/v1/ask/route.ts
// Phase 2: real chat engine — Haiku 4.5 + tool use + citations + persistence.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { runChat, type PriorMessage } from '@/lib/ai/chat'
import {
  getOrCreateConversation,
  loadConversationWithMessages,
  appendMessage,
} from '@/lib/conversations'
import { checkAndRecordUsage } from '@/lib/usage'
import { PADEL_LABS_MODEL } from '@/lib/ai/client'

const MAX_HISTORY_TURNS = 12

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  const conversationId: string | undefined = body.conversation_id || undefined
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'question too long (max 2000 chars)' }, { status: 400 })
  }

  // Rate limit
  const usage = await checkAndRecordUsage({ userId: session.user.id })
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: 'daily_limit_reached',
        message: `You've hit today's free limit of ${usage.quota} questions. Try again tomorrow.`,
        used: usage.used,
        quota: usage.quota,
      },
      { status: 429 },
    )
  }

  // Load or create conversation; load prior history if existing.
  const conversation = await getOrCreateConversation({
    userId: session.user.id,
    conversationId,
    firstUserMessage: question,
  })

  let priorMessages: PriorMessage[] = []
  if (conversationId) {
    const loaded = await loadConversationWithMessages({
      userId: session.user.id,
      conversationId,
    })
    if (loaded) {
      priorMessages = loaded.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    }
  }

  // Persist user message FIRST so it survives if the LLM call fails.
  await appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: question,
  })

  // Run the agentic loop.
  let result
  try {
    result = await runChat({ priorMessages, userMessage: question })
  } catch (e) {
    return NextResponse.json(
      { error: 'chat_failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  // Persist assistant message.
  await appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: result.answer,
    citations: result.citations,
    cost: result.cost,
    model: PADEL_LABS_MODEL,
  })

  return NextResponse.json({
    conversation_id: conversation.id,
    answer: result.answer,
    citations: result.citations,
    cost: result.cost,
    used: usage.used,
    quota: usage.quota,
  })
}

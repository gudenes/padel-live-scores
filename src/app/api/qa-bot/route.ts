// src/app/api/qa-bot/route.ts
// Telegram webhook handler for NachoWatch health monitor agent.
// Receives messages from Telegram, runs Claude with tools, sends response back.

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS } from '@/lib/nacho-watch/tools'
import { executeTool } from '@/lib/nacho-watch/tool-handlers'
import { SYSTEM_PROMPT } from '@/lib/nacho-watch/system-prompt'
import { sendMessage, sendTypingAction, verifyWebhookSecret } from '@/lib/nacho-watch/telegram'

const MAX_TOOL_ROUNDS = 10 // Safety limit on agentic loop iterations

// ── Agentic loop — runs Claude with tools until it produces a final text response ──

export async function runAgent(userMessage: string): Promise<{ text: string; tokensUsed: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ]

  let totalTokens = 0
  let finalText = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })

    totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)

    // Collect assistant content
    const assistantContent: Anthropic.ContentBlockParam[] = []
    for (const block of response.content) {
      if (block.type === 'text') {
        finalText = block.text
        assistantContent.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_use') {
        assistantContent.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        })
      }
    }

    messages.push({ role: 'assistant', content: assistantContent })

    // If Claude is done (no more tool calls), return
    if (response.stop_reason !== 'tool_use') {
      break
    }

    // Execute all tool calls from this turn
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        console.log(`[NachoWatch] Executing tool: ${block.name}`)
        const result = await executeTool(block.name, block.input as Record<string, unknown>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }
    }

    // Send tool results back (must be in a user message)
    messages.push({ role: 'user', content: toolResults })
  }

  return { text: finalText || 'I couldn\'t generate a response. Please try again.', tokensUsed: totalTokens }
}

// ── Telegram webhook POST handler ───────────────────────────────

export async function POST(request: NextRequest) {
  // Verify webhook secret
  if (!verifyWebhookSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const message = body?.message
  if (!message?.text) {
    return Response.json({ ok: true }) // Ignore non-text messages
  }

  const chatId = message.chat.id
  const userText = message.text

  console.log(`[NachoWatch] Message from ${chatId}: ${userText}`)

  // Respond to webhook immediately, process in background
  // (Telegram requires <60s response, but agent might take longer)
  const responsePromise = (async () => {
    try {
      // Show typing indicator
      await sendTypingAction(chatId)

      // Run the agent
      const { text, tokensUsed } = await runAgent(userText)

      // Send response with token usage footer
      const footer = `\n\n_${tokensUsed} tokens used_`
      await sendMessage(chatId, text + footer)
    } catch (err) {
      console.error('[NachoWatch] Agent error:', err)
      await sendMessage(chatId, 'Sorry, I hit an error processing your request. Check the Vercel logs for details.')
    }
  })()

  // Use waitUntil for background processing on Vercel Pro
  // @ts-expect-error — waitUntil is available on Vercel Pro runtime
  if (typeof globalThis.waitUntil === 'function') {
    // @ts-expect-error
    globalThis.waitUntil(responsePromise)
  } else {
    // Local dev: just await
    await responsePromise
  }

  return Response.json({ ok: true })
}

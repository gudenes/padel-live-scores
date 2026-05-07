// apps/labs/src/lib/ai/chat.ts
// Agentic loop: feed prior messages + user message into Haiku, run tools as
// they're requested, return final text + citations + accumulated token cost.
// Phase 2 = Haiku only, no streaming, max 8 tool loops.

import type Anthropic from '@anthropic-ai/sdk'
import {
  anthropicClient,
  PADEL_LABS_MODEL,
  PADEL_LABS_MAX_TOKENS,
  PADEL_LABS_MAX_TOOL_LOOPS,
} from './client'
import { padelLabsSystem } from './system-prompt'
import { PADEL_LABS_TOOLS, dispatchTool } from './tools'
import type { Citation, MatchSummary } from '@/lib/data/types'

export type PriorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatResult = {
  answer: string
  citations: Citation[]
  cost: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens: number
    cache_read_tokens: number
  }
}

export async function runChat(args: {
  priorMessages: PriorMessage[]
  userMessage: string
}): Promise<ChatResult> {
  const client = anthropicClient()
  const messages: Anthropic.Messages.MessageParam[] = [
    ...args.priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: args.userMessage },
  ]

  const cost = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  }

  // Citations accumulate from every tool result that returns matches.
  const matchCitations: Map<string, Citation> = new Map()

  for (let loop = 0; loop < PADEL_LABS_MAX_TOOL_LOOPS; loop++) {
    const response = await client.messages.create({
      model: PADEL_LABS_MODEL,
      max_tokens: PADEL_LABS_MAX_TOKENS,
      system: padelLabsSystem(),
      tools: PADEL_LABS_TOOLS,
      messages,
    })

    cost.input_tokens += response.usage.input_tokens
    cost.output_tokens += response.usage.output_tokens
    cost.cache_creation_tokens += response.usage.cache_creation_input_tokens ?? 0
    cost.cache_read_tokens += response.usage.cache_read_input_tokens ?? 0

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return { answer: text, citations: Array.from(matchCitations.values()), cost }
    }

    // Append assistant content (mix of text + tool_use blocks) verbatim.
    messages.push({ role: 'assistant', content: response.content })

    // Execute every tool_use block and push tool_result blocks back.
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    )
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const tu of toolUseBlocks) {
      const result = await dispatchTool(tu.name, tu.input as Record<string, any>)
      collectCitations(result, matchCitations)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        is_error: !result.ok,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error('runChat: tool loop limit reached')
}

function collectCitations(result: { ok: boolean; data?: unknown }, sink: Map<string, Citation>) {
  if (!result.ok) return
  const arr = Array.isArray(result.data) ? (result.data as MatchSummary[]) : []
  for (const m of arr) {
    if (!m || typeof m !== 'object' || !('id' in m)) continue
    if (sink.has(m.id)) continue
    const pair1 = `${m.pair1?.player1_name ?? '?'} / ${m.pair1?.player2_name ?? '?'}`
    const pair2 = `${m.pair2?.player1_name ?? '?'} / ${m.pair2?.player2_name ?? '?'}`
    sink.set(m.id, {
      match_id: m.id,
      played_at: m.played_at ?? null,
      tournament_name: m.tournament_name ?? null,
      score: (m.set_scores ?? []).join(', '),
      pair1,
      pair2,
    })
  }
}

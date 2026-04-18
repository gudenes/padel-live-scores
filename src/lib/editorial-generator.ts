// src/lib/editorial-generator.ts
// Thin wrapper around the Anthropic SDK that generates an English editorial
// post. The prompt construction + response parsing live in editorial-prompts.ts
// so they're unit-testable without mocking network calls; this file is the
// plumbing that sends the prompt and unwraps the first text block.
//
// Model: claude-opus-4-7 — editorial is the brand voice, quality matters.
//   - adaptive thinking (required on Opus 4.7)
//   - system prompt cached (`cache_control: ephemeral`)
//   - JSON returned as plain text; parsed by parseEditorialResponse

import Anthropic from '@anthropic-ai/sdk'
import {
  EDITORIAL_SYSTEM_PROMPT,
  buildEditorialUserPrompt,
  parseEditorialResponse,
  type EditorialInput,
  type EditorialOutput,
} from './editorial-prompts'

export const EDITORIAL_MODEL = 'claude-opus-4-7'

export interface GenerateEditorialResult {
  output: EditorialOutput
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreateTokens: number
    cacheReadTokens: number
  }
}

/**
 * Generates an English editorial post via Claude Opus.
 * Throws if ANTHROPIC_API_KEY is unset, the API call fails, or the response
 * can't be parsed into the EditorialOutput shape.
 */
export async function generateEditorial(
  input: EditorialInput,
  opts: { apiKey?: string } = {},
): Promise<GenerateEditorialResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[editorial-generator] ANTHROPIC_API_KEY is not set')
  }

  const anthropic = new Anthropic({ apiKey })

  const message = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    // Cache the system prompt — it's >4096 tokens (the Opus 4.7 min cache size)
    // and shared across every editorial we generate this deploy cycle.
    system: [
      {
        type: 'text',
        text: EDITORIAL_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildEditorialUserPrompt(input),
      },
    ],
  })

  const text = extractFirstTextBlock(message)
  if (!text) {
    throw new Error('[editorial-generator] Claude response contained no text block')
  }

  const output = parseEditorialResponse(text)

  return {
    output,
    model: EDITORIAL_MODEL,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreateTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  }
}

/**
 * Pulls the first text block out of a Messages API response. Skips thinking
 * blocks — on Opus 4.7 adaptive thinking is on by default and the response
 * content is a mix of `thinking` and `text` blocks.
 */
function extractFirstTextBlock(message: Anthropic.Message): string | null {
  for (const block of message.content) {
    if (block.type === 'text') return block.text
  }
  return null
}

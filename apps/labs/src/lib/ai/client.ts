// apps/labs/src/lib/ai/client.ts
// Anthropic SDK singleton. Lazy-init so importing this file in test fixtures
// without ANTHROPIC_API_KEY doesn't throw.

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function anthropicClient(): Anthropic {
  if (_client) return _client
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required')
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// Locked to Haiku 4.5 for Phase 2. Phase 4 introduces tier-based routing.
export const PADEL_LABS_MODEL = 'claude-haiku-4-5-20251001'

export const PADEL_LABS_MAX_TOKENS = 2048
export const PADEL_LABS_MAX_TOOL_LOOPS = 8

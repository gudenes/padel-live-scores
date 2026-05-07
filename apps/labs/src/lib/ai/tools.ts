// apps/labs/src/lib/ai/tools.ts
// Anthropic tool definitions + dispatcher. Each tool maps to one data/* skill.
// The dispatcher is the only place that turns tool_use blocks into SQL calls.

import type Anthropic from '@anthropic-ai/sdk'
import { searchPlayer } from '@/lib/data/search-player'
import { getPlayerRecentMatches } from '@/lib/data/player-recent-matches'
import { getHeadToHead } from '@/lib/data/head-to-head'

export const PADEL_LABS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_player',
    description:
      'Find professional padel players by name. Returns up to 5 candidates with id, name, country, category (men/women), and current ranking. Use this to resolve player names to ids before calling other tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial or full player name (e.g., "Tapia", "Galán").' },
        limit: { type: 'integer', description: 'Max results (default 5, max 20).', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_player_recent_matches',
    description:
      'Get the last N completed matches for a player by id. Returns id, date, tournament, opponent pair names, set scores, and winner. Default 5, max 25.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string', description: 'Canonical player id (UUID) from search_player.' },
        limit: { type: 'integer', description: 'Max results (default 5, max 25).', minimum: 1, maximum: 25 },
      },
      required: ['player_id'],
    },
  },
  {
    name: 'get_head_to_head',
    description:
      'Get matches between two players on OPPOSING pairs. The most-asked padel question. Resolve both player names via search_player first, then pass their UUIDs.',
    input_schema: {
      type: 'object',
      properties: {
        player_a_id: { type: 'string', description: 'First player id (UUID).' },
        player_b_id: { type: 'string', description: 'Second player id (UUID).' },
        limit: { type: 'integer', description: 'Max results (default 25, max 100).', minimum: 1, maximum: 100 },
      },
      required: ['player_a_id', 'player_b_id'],
    },
  },
]

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

export async function dispatchTool(name: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'search_player': {
        const data = await searchPlayer(input.query, { limit: input.limit })
        return { ok: true, data }
      }
      case 'get_player_recent_matches': {
        const data = await getPlayerRecentMatches(input.player_id, { limit: input.limit })
        return { ok: true, data }
      }
      case 'get_head_to_head': {
        const data = await getHeadToHead(input.player_a_id, input.player_b_id, { limit: input.limit })
        return { ok: true, data }
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// src/lib/nacho-watch/tools.ts
// Tool definitions for the NachoWatch health monitor agent.
// Claude uses these schemas to decide which tools to call.

import type Anthropic from '@anthropic-ai/sdk'

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'check_relay_health',
    description:
      'Ping the Railway relay service to check if it is running and connected to Pusher WebSocket. Returns connection state, number of active match channels, and process uptime.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_live_matches',
    description:
      'Get all currently live matches from the database. Returns match count, tournament names, player names, scores, and when each match was last updated. Use this to check if live scoring is working.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['men', 'women', 'all'],
          description: 'Filter by category. Defaults to all.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_cron_status',
    description:
      'Check the status of recent cron job runs. Returns the last run time, success/failure status, duration, and any error messages for each cron job (scores, sync, highlights, articles, rankings).',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description:
            'Filter to a specific cron source (e.g., "cron:scores", "cron:highlights"). Omit to see all.',
        },
        hours: {
          type: 'number',
          description: 'How many hours back to look. Defaults to 24.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_stale_matches',
    description:
      'Find matches that are stuck in "live" status but have not received any score updates recently. These may need manual intervention to be marked as finished.',
    input_schema: {
      type: 'object' as const,
      properties: {
        threshold_minutes: {
          type: 'number',
          description:
            'Consider a match stale if no updates for this many minutes. Defaults to 30.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_data_quality',
    description:
      'Check data quality metrics: matches with missing player IDs, matches without scores, tournaments without logos, and other data integrity issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tournament_id: {
          type: 'string',
          description: 'Filter to a specific tournament UUID. Omit for all recent tournaments.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_rate_limit_info',
    description:
      'Check the padelapi.org API rate limit usage. Returns estimated daily quota usage, remaining calls, and whether any cron runs were skipped due to rate limiting.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

'use client'
// src/app/ops/ArchitectureTab.tsx
// Live architecture diagram showing all data integrations, sources, and data flow.

import React from 'react'

// ── Integration definitions ─────────────────────────────────────

interface Integration {
  name: string
  category: 'live-data' | 'tournaments' | 'content' | 'stats' | 'ops'
  source: string
  url: string
  cronRoute: string
  schedule: string
  tables: string[]
  priority: string
  auth: string
  status: 'active' | 'paused' | 'always-on'
  color: string
  icon: string
  description: string
}

const INTEGRATIONS: Integration[] = [
  {
    name: 'PadelAPI Live Scores',
    category: 'live-data',
    source: 'padelapi.org',
    url: 'https://padelapi.org/api',
    cronRoute: '/api/cron/scores',
    schedule: 'Every 2 min',
    tables: ['matches', 'sets', 'games', 'players'],
    priority: 'Primary for match data',
    auth: 'PADELAPI_TOKEN',
    status: 'active',
    color: '#22c55e',
    icon: '⚡',
    description: 'Polls live matches, upserts scores, detects stale matches, reconciles finished matches',
  },
  {
    name: 'Pusher WebSocket Relay',
    category: 'live-data',
    source: 'padelapi.org (Pusher)',
    url: 'wss://eu.pusher.com',
    cronRoute: 'relay/index.js (Railway)',
    schedule: 'Always-on',
    tables: ['games (points)', 'matches'],
    priority: 'Real-time point-by-point',
    auth: 'PUSHER_APP_KEY',
    status: 'always-on',
    color: '#8b5cf6',
    icon: '🔌',
    description: 'Persistent WebSocket connection for real-time point updates during live matches',
  },
  {
    name: 'PadelAPI Sync',
    category: 'tournaments',
    source: 'padelapi.org',
    url: 'https://padelapi.org/api',
    cronRoute: '/api/cron/sync',
    schedule: 'Hourly + Weekly Mon 4am',
    tables: ['matches', 'players', 'tournaments', 'seasons'],
    priority: 'Primary for player names, match metadata',
    auth: 'PADELAPI_TOKEN',
    status: 'active',
    color: '#22c55e',
    icon: '🔄',
    description: 'Hourly match metadata sync + weekly full sync (tournaments, players, seasons)',
  },
  {
    name: 'FIP Rankings',
    category: 'tournaments',
    source: 'padelfip.com',
    url: 'padelfip.com/wp-json/wp/v2',
    cronRoute: '/api/cron/sync-fip-rankings',
    schedule: 'Daily 5am UTC',
    tables: ['players'],
    priority: 'Highest for rankings (fip_official)',
    auth: 'None',
    status: 'active',
    color: '#f59e0b',
    icon: '🏅',
    description: 'FIP official + race rankings for top 1000 players, both genders',
  },
  {
    name: 'FIP Tournaments',
    category: 'tournaments',
    source: 'padelfip.com',
    url: 'padelfip.com/wp-json/wp/v2/events',
    cronRoute: '/api/cron/fip-tournaments',
    schedule: 'Every 12h (manual)',
    tables: ['tournaments'],
    priority: 'Primary for FIP tournament metadata, logos',
    auth: 'None',
    status: 'paused',
    color: '#f59e0b',
    icon: '🏆',
    description: 'FIP tournament discovery via WordPress API + overview page scraping for venue/prize',
  },
  {
    name: 'FIP Match Scores',
    category: 'tournaments',
    source: 'matchscorerlive.com',
    url: 'widget.matchscorerlive.com',
    cronRoute: '/api/cron/fip-scores',
    schedule: 'Every 2h (manual)',
    tables: ['matches'],
    priority: 'Secondary for FIP match results',
    auth: 'None (HTML scraping)',
    status: 'paused',
    color: '#f59e0b',
    icon: '📊',
    description: 'Scrapes MatchScorer Live widget for FIP draw tables, match results, player assignments',
  },
  {
    name: 'Premier Padel Stats',
    category: 'stats',
    source: 'premierpadel.com',
    url: 'premierpadel.com/api/beforeauth/*',
    cronRoute: '/api/cron/premier-stats',
    schedule: 'Hourly :13',
    tables: ['match_stats', 'entity_external_ids'],
    priority: 'Primary for per-set match statistics',
    auth: 'None (beforeauth)',
    status: 'active',
    color: '#3b82f6',
    icon: '📈',
    description: 'Per-set service/return/points statistics from Premier Padel API',
  },
  {
    name: 'Premier Padel Discovery',
    category: 'stats',
    source: 'premierpadel.com',
    url: 'premierpadel.com/api/beforeauth/*',
    cronRoute: '/api/cron/premier-discovery',
    schedule: 'Weekly Mon 4am',
    tables: ['entity_external_ids', 'match_stats_unresolved'],
    priority: 'Links Premier tournaments/matches to our DB',
    auth: 'None (beforeauth)',
    status: 'active',
    color: '#3b82f6',
    icon: '🔗',
    description: 'Links Premier Padel tournaments and matches to internal entities via token-based matching',
  },
  {
    name: 'YouTube Highlights',
    category: 'content',
    source: 'YouTube Data API',
    url: 'googleapis.com/youtube/v3',
    cronRoute: '/api/cron/sync-highlights',
    schedule: 'Hourly :20',
    tables: ['highlights'],
    priority: 'Primary for video content',
    auth: 'YOUTUBE_API_KEY',
    status: 'active',
    color: '#ef4444',
    icon: '🎬',
    description: 'Fetches padel highlight videos from YouTube channels, tracks engagement metrics',
  },
  {
    name: 'Google News RSS',
    category: 'content',
    source: 'Google News',
    url: 'news.google.com/rss/search',
    cronRoute: '/api/cron/sync-articles',
    schedule: 'Hourly :40',
    tables: ['articles'],
    priority: 'Secondary for news (weight 1.0)',
    auth: 'None (RSS)',
    status: 'active',
    color: '#6366f1',
    icon: '📰',
    description: 'Multi-language padel news from Google News RSS (EN, ES, PT-BR, PT)',
  },
  {
    name: 'Padel News RSS',
    category: 'content',
    source: 'Padeladdict, Padelmagazine',
    url: 'padeladdict.com/feed, padelmagazine.fr/feed',
    cronRoute: '/api/cron/sync-articles',
    schedule: 'Hourly :40',
    tables: ['articles'],
    priority: 'Higher priority (weight 1.2)',
    auth: 'None (RSS)',
    status: 'active',
    color: '#6366f1',
    icon: '📝',
    description: 'Specialized padel magazines — higher weight than generic Google News',
  },
  {
    name: 'FIP News',
    category: 'content',
    source: 'padelfip.com',
    url: 'padelfip.com/wp-json/wp/v2/posts',
    cronRoute: '/api/cron/sync-articles',
    schedule: 'Hourly :40',
    tables: ['articles'],
    priority: 'Highest priority (weight 1.5)',
    auth: 'None',
    status: 'active',
    color: '#f59e0b',
    icon: '🏛️',
    description: 'Official FIP announcements and tournament news — highest content weight',
  },
  {
    name: 'Premier Broadcasters',
    category: 'content',
    source: 'premierpadel.com',
    url: 'premierpadel.com/api/beforeauth/getwheretowatch*',
    cronRoute: '/api/cron/sync-broadcasters',
    schedule: 'Weekly Sun 4am',
    tables: ['broadcasters', 'broadcast_info'],
    priority: 'Primary for where-to-watch',
    auth: 'None (beforeauth)',
    status: 'active',
    color: '#3b82f6',
    icon: '📺',
    description: 'Where-to-watch info — broadcaster names, URLs, country coverage, free/paid status',
  },
  {
    name: 'Claude AI (Social)',
    category: 'ops',
    source: 'Anthropic Claude API',
    url: 'api.anthropic.com',
    cronRoute: '/api/cron/social-drafts',
    schedule: 'Weekly Mon 8am',
    tables: ['social_posts'],
    priority: 'Generates social media drafts',
    auth: 'ANTHROPIC_API_KEY',
    status: 'active',
    color: '#d97706',
    icon: '🤖',
    description: 'Generates social media post drafts from match results, saved to social_posts table',
  },
  {
    name: 'Health Monitor',
    category: 'ops',
    source: 'Telegram Bot API',
    url: 'api.telegram.org',
    cronRoute: '/api/cron/nacho-health',
    schedule: 'Daily 7am',
    tables: [],
    priority: 'Monitoring only',
    auth: 'TELEGRAM_BOT_TOKEN',
    status: 'active',
    color: '#0ea5e9',
    icon: '🩺',
    description: 'Daily health report sent to Telegram — match coverage, data freshness, error counts',
  },
]

const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'live-data', label: 'Live Data', color: '#22c55e' },
  { key: 'tournaments', label: 'Tournaments & Rankings', color: '#f59e0b' },
  { key: 'stats', label: 'Match Statistics', color: '#3b82f6' },
  { key: 'content', label: 'Content & Media', color: '#6366f1' },
  { key: 'ops', label: 'Operations', color: '#d97706' },
]

// ── Styles ──────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

// ── Component ───────────────────────────────────────────────────

export default function ArchitectureTab() {
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
          {INTEGRATIONS.length} integrations · {INTEGRATIONS.filter(i => i.status === 'active').length} active · {INTEGRATIONS.filter(i => i.status === 'paused').length} paused · {INTEGRATIONS.filter(i => i.status === 'always-on').length} always-on
        </div>
      </div>

      {/* Source Priority Legend */}
      <div style={{ ...card, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontSize: 10, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, width: '100%' }}>
          Source Priority (who wins when data conflicts)
        </div>
        <div style={{ fontSize: 11, color: '#333', lineHeight: 1.6 }}>
          <strong>Rankings:</strong> FIP Official → FIP → PadelAPI
          <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
          <strong>Match scores:</strong> PadelAPI → Inferred → Live relay
          <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
          <strong>Player names:</strong> PadelAPI → FIP → Manual
          <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
          <strong>Match stats:</strong> Premier Padel (exclusive)
          <span style={{ color: '#ccc', margin: '0 8px' }}>|</span>
          <strong>News:</strong> FIP (1.5×) → Padel RSS (1.2×) → Google News (1.0×)
        </div>
      </div>

      {/* Integration cards by category */}
      {CATEGORIES.map(cat => {
        const items = INTEGRATIONS.filter(i => i.category === cat.key)
        if (items.length === 0) return null
        return (
          <div key={cat.key} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: cat.color,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: cat.color }} />
              {cat.label}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340, 1fr))', gap: 10 }}>
              {items.map(integ => (
                <div key={integ.name} style={{
                  ...card,
                  borderLeft: `3px solid ${integ.color}`,
                  opacity: integ.status === 'paused' ? 0.6 : 1,
                }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{integ.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{integ.name}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>{integ.source}</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                      background: integ.status === 'active' ? '#dcfce7' : integ.status === 'always-on' ? '#ede9fe' : '#fef3c7',
                      color: integ.status === 'active' ? '#166534' : integ.status === 'always-on' ? '#5b21b6' : '#92400e',
                    }}>
                      {integ.status === 'active' ? '● Active' : integ.status === 'always-on' ? '◉ Always-on' : '○ Paused'}
                    </span>
                  </div>

                  {/* Description */}
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 8, lineHeight: 1.4 }}>
                    {integ.description}
                  </div>

                  {/* Details grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 10 }}>
                    <div>
                      <span style={{ color: '#999', fontWeight: 600 }}>Schedule: </span>
                      <span style={{ color: '#333' }}>{integ.schedule}</span>
                    </div>
                    <div>
                      <span style={{ color: '#999', fontWeight: 600 }}>Auth: </span>
                      <span style={{ color: '#333', fontFamily: 'monospace', fontSize: 9 }}>{integ.auth}</span>
                    </div>
                    <div>
                      <span style={{ color: '#999', fontWeight: 600 }}>Route: </span>
                      <span style={{ color: '#333', fontFamily: 'monospace', fontSize: 9 }}>{integ.cronRoute}</span>
                    </div>
                    <div>
                      <span style={{ color: '#999', fontWeight: 600 }}>Priority: </span>
                      <span style={{ color: '#333' }}>{integ.priority}</span>
                    </div>
                  </div>

                  {/* Target tables */}
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {integ.tables.map(t => (
                      <span key={t} style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                        background: '#f3f4f6', color: '#555', fontFamily: 'monospace',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Data flow summary */}
      <div style={{ ...card, marginTop: 8, background: '#f9fafb' }}>
        <div style={{ fontSize: 10, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Data Flow Summary
        </div>
        <div style={{ fontSize: 11, color: '#555', lineHeight: 1.8 }}>
          <div><strong>Live matches:</strong> PadelAPI (poll every 2min) + Pusher relay (real-time points) → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>matches</code> + <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>sets</code> + <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>games</code></div>
          <div><strong>Player profiles:</strong> PadelAPI (names) + FIP Rankings (official rankings) → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>players</code></div>
          <div><strong>Match statistics:</strong> Premier Padel API → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>match_stats</code> (linked via <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>entity_external_ids</code>)</div>
          <div><strong>News feed:</strong> FIP WordPress + Google News RSS + Padel magazines → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>articles</code></div>
          <div><strong>Video highlights:</strong> YouTube Data API → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>highlights</code></div>
          <div><strong>Where to watch:</strong> Premier Padel API → <code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>broadcasters</code></div>
          <div><strong>Player resolution:</strong> PlayerResolver (in-app) with 5-tier hierarchy: fip_id → external_id → alias → normalized name → fuzzy match</div>
          <div><strong>Score inference:</strong> When API has no final score → infer from point data (<code style={{ fontSize: 10, background: '#e5e7eb', padding: '0 3px', borderRadius: 2 }}>score-inference.ts</code>)</div>
        </div>
      </div>
    </div>
  )
}

'use client'
// src/app/ops/ArchitectureTab.tsx
// System architecture diagram — visual flow diagram showing all data integrations.

import React, { useState } from 'react'

// ── Node + connection definitions ───────────────────────────────

interface DiagramNode {
  id: string
  label: string
  sublabel?: string
  x: number
  y: number
  w: number
  h: number
  color: string
  textColor: string
  icon: string
  badge?: string
  details?: string[]
}

interface Connection {
  from: string
  to: string
  label?: string
  color?: string
  dashed?: boolean
  bidirectional?: boolean
}

// All nodes positioned on a 1200x900 canvas
const NODES: DiagramNode[] = [
  // ── External Sources (left column) ──
  { id: 'padelapi', label: 'PadelAPI', sublabel: 'padelapi.org', x: 20, y: 80, w: 150, h: 60, color: '#dcfce7', textColor: '#166534', icon: '⚡', badge: 'Every 2min',
    details: ['Live scores', 'Tournaments', 'Players', 'Match metadata'] },
  { id: 'pusher', label: 'Pusher WebSocket', sublabel: 'Real-time relay', x: 20, y: 170, w: 150, h: 60, color: '#ede9fe', textColor: '#5b21b6', icon: '🔌', badge: 'Always-on',
    details: ['Point-by-point updates', 'Railway Node.js service'] },
  { id: 'fip', label: 'FIP / padelfip.com', sublabel: 'WordPress API + scraping', x: 20, y: 280, w: 150, h: 60, color: '#fef3c7', textColor: '#92400e', icon: '🏆', badge: 'Daily + Weekly',
    details: ['Rankings (daily)', 'Tournaments (weekly)', 'News (hourly)', 'MatchScorer draws'] },
  { id: 'premier', label: 'Premier Padel', sublabel: 'premierpadel.com API', x: 20, y: 390, w: 150, h: 60, color: '#dbeafe', textColor: '#1e40af', icon: '📈', badge: 'Hourly',
    details: ['Per-set match stats', 'Tournament calendar', 'Broadcaster info'] },
  { id: 'youtube', label: 'YouTube', sublabel: 'Data API v3', x: 20, y: 500, w: 150, h: 60, color: '#fee2e2', textColor: '#991b1b', icon: '🎬', badge: 'Hourly :20',
    details: ['Highlight videos', 'Channel engagement metrics'] },
  { id: 'rss', label: 'News RSS Feeds', sublabel: 'Google + Padel magazines', x: 20, y: 610, w: 150, h: 60, color: '#e0e7ff', textColor: '#3730a3', icon: '📰', badge: 'Hourly :40',
    details: ['EN/ES/PT/BR news', 'Padeladdict', 'Padelmagazine', 'FIP WordPress'] },

  // ── Cron Jobs (middle-left column) ──
  { id: 'cron-scores', label: 'Score Agent', sublabel: '/api/cron/scores', x: 250, y: 80, w: 140, h: 44, color: '#f0fdf4', textColor: '#166534', icon: '🔄' },
  { id: 'relay', label: 'Relay Service', sublabel: 'relay/index.js', x: 250, y: 170, w: 140, h: 44, color: '#f5f3ff', textColor: '#5b21b6', icon: '📡' },
  { id: 'cron-sync', label: 'Sync Cron', sublabel: '/api/cron/sync', x: 250, y: 240, w: 140, h: 44, color: '#f0fdf4', textColor: '#166534', icon: '🔄' },
  { id: 'cron-rankings', label: 'Rankings Sync', sublabel: '/api/cron/sync-fip-rankings', x: 250, y: 300, w: 140, h: 44, color: '#fffbeb', textColor: '#92400e', icon: '🏅' },
  { id: 'cron-premier', label: 'Premier Stats', sublabel: '/api/cron/premier-stats', x: 250, y: 390, w: 140, h: 44, color: '#eff6ff', textColor: '#1e40af', icon: '📊' },
  { id: 'cron-highlights', label: 'Highlights Sync', sublabel: '/api/cron/sync-highlights', x: 250, y: 500, w: 140, h: 44, color: '#fef2f2', textColor: '#991b1b', icon: '🎥' },
  { id: 'cron-articles', label: 'Articles Sync', sublabel: '/api/cron/sync-articles', x: 250, y: 610, w: 140, h: 44, color: '#eef2ff', textColor: '#3730a3', icon: '📝' },

  // ── Processing Layer (middle column) ──
  { id: 'resolver', label: 'Player Resolver', sublabel: '5-tier matching', x: 460, y: 160, w: 150, h: 55, color: '#fdf4ff', textColor: '#86198f', icon: '🧠',
    details: ['fip_id → external_id → alias → name → fuzzy', 'Auto-stores name aliases', 'Ranking disambiguation'] },
  { id: 'inference', label: 'Score Inference', sublabel: 'score-inference.ts', x: 460, y: 240, w: 150, h: 45, color: '#fdf4ff', textColor: '#86198f', icon: '🔮',
    details: ['Infers final set from points', 'Winner determination', 'Validates padel rules'] },
  { id: 'priority', label: 'Source Priority', sublabel: 'source-priority.ts', x: 460, y: 310, w: 150, h: 45, color: '#fdf4ff', textColor: '#86198f', icon: '⚖️',
    details: ['Per-field ownership rules', 'Prevents source conflicts'] },
  { id: 'feed-engine', label: 'Feed Engine', sublabel: 'feed-scoring.ts', x: 460, y: 560, w: 150, h: 50, color: '#fdf4ff', textColor: '#86198f', icon: '🎯',
    details: ['Freshness × popularity × weight', 'Language affinity', 'Channel quality', 'Title dedup'] },

  // ── Database (center-right) ──
  { id: 'supabase', label: 'Supabase', sublabel: 'PostgreSQL + Realtime', x: 700, y: 190, w: 160, h: 280, color: '#f0fdf4', textColor: '#166534', icon: '🗄️' },

  // ── Frontend (right column) ──
  { id: 'nextjs', label: 'Next.js App', sublabel: 'Vercel (App Router)', x: 950, y: 80, w: 160, h: 60, color: '#f8fafc', textColor: '#0f172a', icon: '▲',
    details: ['SSR + Client components', 'PWA (mobile-first)', 'Dark theme'] },
  { id: 'browser', label: "User's Browser", sublabel: 'Mobile / Desktop', x: 950, y: 180, w: 160, h: 50, color: '#fff7ed', textColor: '#9a3412', icon: '📱' },

  // ── Ops (bottom-right) ──
  { id: 'ops', label: 'Ops Dashboard', sublabel: '/ops', x: 950, y: 390, w: 160, h: 50, color: '#f1f5f9', textColor: '#334155', icon: '🎛️',
    details: ['Entry lists', 'Draw editor', 'Player dedup', 'Architecture'] },

  // ── External Services (bottom) ──
  { id: 'claude', label: 'Claude AI', sublabel: 'Anthropic API', x: 460, y: 700, w: 140, h: 45, color: '#fef3c7', textColor: '#92400e', icon: '🤖',
    details: ['Social post generation', 'AI duplicate scan', 'Draw PDF parsing'] },
  { id: 'telegram', label: 'Telegram', sublabel: 'Health alerts', x: 640, y: 700, w: 120, h: 45, color: '#e0f2fe', textColor: '#0369a1', icon: '🩺' },
  { id: 'storage', label: 'Supabase Storage', sublabel: 'Player avatars', x: 950, y: 290, w: 160, h: 45, color: '#f0fdf4', textColor: '#166534', icon: '🖼️' },
]

const CONNECTIONS: Connection[] = [
  // External → Crons
  { from: 'padelapi', to: 'cron-scores', label: 'REST API', color: '#22c55e' },
  { from: 'padelapi', to: 'cron-sync', label: 'REST API', color: '#22c55e' },
  { from: 'pusher', to: 'relay', label: 'WebSocket', color: '#8b5cf6' },
  { from: 'fip', to: 'cron-rankings', label: 'WP API', color: '#f59e0b' },
  { from: 'premier', to: 'cron-premier', label: 'beforeauth API', color: '#3b82f6' },
  { from: 'youtube', to: 'cron-highlights', label: 'Data API v3', color: '#ef4444' },
  { from: 'rss', to: 'cron-articles', label: 'RSS / WP API', color: '#6366f1' },

  // Crons → Processing
  { from: 'cron-scores', to: 'resolver', color: '#86198f', dashed: true },
  { from: 'cron-sync', to: 'resolver', color: '#86198f', dashed: true },
  { from: 'cron-scores', to: 'inference', color: '#86198f', dashed: true },
  { from: 'cron-scores', to: 'priority', color: '#86198f', dashed: true },
  { from: 'cron-articles', to: 'feed-engine', color: '#86198f', dashed: true },

  // Crons → DB
  { from: 'cron-scores', to: 'supabase', label: 'matches, sets, games', color: '#22c55e' },
  { from: 'relay', to: 'supabase', label: 'games (points)', color: '#8b5cf6' },
  { from: 'cron-sync', to: 'supabase', label: 'players, tournaments', color: '#22c55e' },
  { from: 'cron-rankings', to: 'supabase', label: 'players (rankings)', color: '#f59e0b' },
  { from: 'cron-premier', to: 'supabase', label: 'match_stats', color: '#3b82f6' },
  { from: 'cron-highlights', to: 'supabase', label: 'highlights', color: '#ef4444' },
  { from: 'cron-articles', to: 'supabase', label: 'articles', color: '#6366f1' },

  // Processing → DB
  { from: 'resolver', to: 'supabase', color: '#86198f', dashed: true },
  { from: 'inference', to: 'supabase', color: '#86198f', dashed: true },

  // DB → Frontend
  { from: 'supabase', to: 'nextjs', label: 'SSR queries', color: '#0f172a', bidirectional: true },
  { from: 'supabase', to: 'browser', label: 'Realtime WS', color: '#22c55e' },
  { from: 'nextjs', to: 'browser', label: 'HTML/JS', color: '#0f172a' },
  { from: 'storage', to: 'browser', label: 'Images', color: '#22c55e' },

  // DB → Ops
  { from: 'supabase', to: 'ops', label: 'CRUD', color: '#334155', bidirectional: true },

  // Claude + Telegram
  { from: 'claude', to: 'supabase', label: 'social_posts', color: '#d97706' },
  { from: 'telegram', to: 'ops', label: 'Alerts', color: '#0369a1', dashed: true },
]

// ── DB tables shown inside Supabase node ──
const DB_TABLES = [
  { name: 'matches', color: '#22c55e' },
  { name: 'players', color: '#f59e0b' },
  { name: 'tournaments', color: '#f59e0b' },
  { name: 'sets / games', color: '#22c55e' },
  { name: 'match_stats', color: '#3b82f6' },
  { name: 'highlights', color: '#ef4444' },
  { name: 'articles', color: '#6366f1' },
  { name: 'social_posts', color: '#d97706' },
  { name: 'entity_external_ids', color: '#86198f' },
]

// ── Rendering helpers ───────────────────────────────────────────

function getNodeCenter(node: DiagramNode): [number, number] {
  return [node.x + node.w / 2, node.y + node.h / 2]
}

function getConnectionPath(from: DiagramNode, to: DiagramNode): string {
  const [fx, fy] = getNodeCenter(from)
  const [tx, ty] = getNodeCenter(to)

  // Determine which edges to connect
  let startX = fx, startY = fy, endX = tx, endY = ty

  if (fx + from.w / 2 < tx - to.w / 2) {
    // from is left of to — connect right edge to left edge
    startX = from.x + from.w
    endX = to.x
    startY = fy
    endY = ty
  } else if (tx + to.w / 2 < fx - from.w / 2) {
    // to is left of from
    startX = from.x
    endX = to.x + to.w
    startY = fy
    endY = ty
  } else if (fy < ty) {
    // from is above to
    startX = fx
    startY = from.y + from.h
    endX = tx
    endY = to.y
  } else {
    startX = fx
    startY = from.y
    endX = tx
    endY = to.y + to.h
  }

  // Curved path
  const midX = (startX + endX) / 2
  return `M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`
}

// ── Component ───────────────────────────────────────────────────

export default function ArchitectureTab() {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const nodeMap = new Map(NODES.map(n => [n.id, n]))

  const hoveredConnections = hoveredNode
    ? CONNECTIONS.filter(c => c.from === hoveredNode || c.to === hoveredNode)
    : []
  const hoveredIds = new Set(hoveredConnections.flatMap(c => [c.from, c.to]))

  return (
    <div>
      {/* Legend */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12, padding: '8px 12px',
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11,
      }}>
        {[
          { color: '#dcfce7', border: '#22c55e', label: 'Live Data Sources' },
          { color: '#fef3c7', border: '#f59e0b', label: 'Tournament / Rankings' },
          { color: '#dbeafe', border: '#3b82f6', label: 'Match Statistics' },
          { color: '#fee2e2', border: '#ef4444', label: 'Video Content' },
          { color: '#e0e7ff', border: '#6366f1', label: 'News / Articles' },
          { color: '#fdf4ff', border: '#86198f', label: 'Processing Layer' },
          { color: '#f0fdf4', border: '#166534', label: 'Database' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: l.color, border: `1.5px solid ${l.border}` }} />
            <span style={{ color: '#555' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* SVG Diagram */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <svg viewBox="0 0 1160 780" style={{ width: '100%', minWidth: 900, display: 'block' }}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#999" />
            </marker>
            <marker id="arrow-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
            </marker>
            <marker id="arrow-blue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
            </marker>
            <filter id="shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.08)" />
            </filter>
          </defs>

          {/* Column labels */}
          <text x="95" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill="#999" letterSpacing="1">EXTERNAL SOURCES</text>
          <text x="320" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill="#999" letterSpacing="1">CRON JOBS</text>
          <text x="535" y="130" textAnchor="middle" fontSize="11" fontWeight="700" fill="#999" letterSpacing="1">PROCESSING</text>
          <text x="780" y="170" textAnchor="middle" fontSize="11" fontWeight="700" fill="#999" letterSpacing="1">DATABASE</text>
          <text x="1030" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill="#999" letterSpacing="1">FRONTEND</text>

          {/* Connections */}
          {CONNECTIONS.map((conn, i) => {
            const fromNode = nodeMap.get(conn.from)
            const toNode = nodeMap.get(conn.to)
            if (!fromNode || !toNode) return null

            const isHighlighted = hoveredNode && hoveredIds.has(conn.from) && hoveredIds.has(conn.to)
            const isDimmed = hoveredNode && !isHighlighted
            const path = getConnectionPath(fromNode, toNode)

            return (
              <g key={i} opacity={isDimmed ? 0.1 : 1} style={{ transition: 'opacity 0.2s' }}>
                <path
                  d={path}
                  fill="none"
                  stroke={conn.color || '#ccc'}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  strokeDasharray={conn.dashed ? '5,3' : undefined}
                  markerEnd="url(#arrow)"
                />
                {conn.label && (() => {
                  const [fx] = getNodeCenter(fromNode)
                  const [tx] = getNodeCenter(toNode)
                  const [, fy2] = getNodeCenter(fromNode)
                  const [, ty2] = getNodeCenter(toNode)
                  const mx = (fx + tx) / 2
                  const my = (fy2 + ty2) / 2
                  return (
                    <g>
                      <rect x={mx - conn.label.length * 3} y={my - 7} width={conn.label.length * 6} height={14} rx={3} fill="white" opacity={0.9} />
                      <text x={mx} y={my + 3} textAnchor="middle" fontSize="8" fill="#888" fontWeight="500">
                        {conn.label}
                      </text>
                    </g>
                  )
                })()}
              </g>
            )
          })}

          {/* Supabase node (large, with tables inside) */}
          {(() => {
            const db = nodeMap.get('supabase')!
            const isDimmed = hoveredNode && !hoveredIds.has('supabase')
            return (
              <g opacity={isDimmed ? 0.3 : 1} style={{ transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHoveredNode('supabase')}
                onMouseLeave={() => setHoveredNode(null)}>
                <rect x={db.x} y={db.y} width={db.w} height={db.h} rx={8} fill={db.color}
                  stroke="#22c55e" strokeWidth={2} filter="url(#shadow)" />
                <text x={db.x + 12} y={db.y + 20} fontSize="13" fontWeight="700" fill={db.textColor}>
                  {db.icon} {db.label}
                </text>
                <text x={db.x + 12} y={db.y + 34} fontSize="9" fill="#888">{db.sublabel}</text>
                {/* Table pills */}
                {DB_TABLES.map((t, i) => (
                  <g key={t.name}>
                    <rect x={db.x + 8} y={db.y + 48 + i * 24} width={db.w - 16} height={19} rx={4}
                      fill="white" stroke={t.color} strokeWidth={1} />
                    <text x={db.x + 16} y={db.y + 61 + i * 24} fontSize="9" fontWeight="600" fill="#333"
                      fontFamily="monospace">
                      {t.name}
                    </text>
                  </g>
                ))}
              </g>
            )
          })()}

          {/* All other nodes */}
          {NODES.filter(n => n.id !== 'supabase').map(node => {
            const isDimmed = hoveredNode && hoveredNode !== node.id && !hoveredIds.has(node.id)
            return (
              <g key={node.id}
                opacity={isDimmed ? 0.3 : 1}
                style={{ transition: 'opacity 0.2s', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={6}
                  fill={node.color} stroke={hoveredNode === node.id ? node.textColor : '#e5e7eb'}
                  strokeWidth={hoveredNode === node.id ? 2 : 1} filter="url(#shadow)" />
                <text x={node.x + 8} y={node.y + 18} fontSize="11" fontWeight="700" fill={node.textColor}>
                  {node.icon} {node.label}
                </text>
                {node.sublabel && (
                  <text x={node.x + 8} y={node.y + 32} fontSize="8" fill="#999">{node.sublabel}</text>
                )}
                {node.badge && (
                  <g>
                    <rect x={node.x + node.w - node.badge.length * 5 - 12} y={node.y + 4}
                      width={node.badge.length * 5 + 8} height={14} rx={3} fill="white" stroke="#e5e7eb" strokeWidth={0.5} />
                    <text x={node.x + node.w - 8} y={node.y + 14} textAnchor="end"
                      fontSize="7" fontWeight="600" fill="#888">
                      {node.badge}
                    </text>
                  </g>
                )}
                {/* Details on hover */}
                {hoveredNode === node.id && node.details && (
                  <g>
                    <rect x={node.x} y={node.y + node.h + 4} width={Math.max(node.w, 180)}
                      height={node.details.length * 16 + 10} rx={6}
                      fill="white" stroke="#e5e7eb" strokeWidth={1} filter="url(#shadow)" />
                    {node.details.map((d, i) => (
                      <text key={i} x={node.x + 8} y={node.y + node.h + 18 + i * 16}
                        fontSize="9" fill="#555">
                        • {d}
                      </text>
                    ))}
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Source Priority footer */}
      <div style={{
        marginTop: 12, padding: '10px 14px', background: 'white', border: '1px solid #e5e7eb',
        borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.8,
      }}>
        <div style={{ fontSize: 10, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Source Priority (who wins on data conflicts)
        </div>
        <strong>Rankings:</strong> FIP Official → FIP → PadelAPI
        <span style={{ color: '#ddd', margin: '0 8px' }}>|</span>
        <strong>Match scores:</strong> PadelAPI → Inferred → Live relay
        <span style={{ color: '#ddd', margin: '0 8px' }}>|</span>
        <strong>Player names:</strong> PadelAPI → FIP → Manual
        <span style={{ color: '#ddd', margin: '0 8px' }}>|</span>
        <strong>Match stats:</strong> Premier Padel (exclusive)
        <span style={{ color: '#ddd', margin: '0 8px' }}>|</span>
        <strong>News:</strong> FIP (1.5×) → Padel RSS (1.2×) → Google News (1.0×)
      </div>
    </div>
  )
}

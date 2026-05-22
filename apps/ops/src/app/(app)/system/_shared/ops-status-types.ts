// Shared types, helpers, constants, and style objects for the ops-status tabs
// (Integration Health + Data Quality). Copied verbatim from
// src/app/ops/OpsClient.tsx in the main app and kept in sync by hand.

import type React from 'react'

// ── Types ─────────────────────────────────────────────────────────

export interface HealthEntry {
  status: string
  started_at: string | null
  duration_ms: number | null
  meta: Record<string, unknown> | null
  error_message: string | null
}

export interface RelayStatus {
  ok: boolean
  pusher_state: string
  active_channels: number
  uptime: number
}

export interface StaleMatch {
  id: string
  external_id: string
  updated_at: string
}

export interface OngoingEvent {
  tournament_id: string
  name: string
  level: string | null
  country: string | null
  categories: string[]
  live: number
  scheduled: number
  finished: number
  total: number
}

export interface DashboardData {
  health: Record<string, HealthEntry>
  relay: RelayStatus
  freshness: {
    live_matches: number
    last_score_update: string | null
    stale_matches: StaleMatch[]
  }
  quality: {
    total_matches: number
    with_pbp: number
    missing_scores: number
    unresolved_players: number
    total_tournaments: number
    ongoing_events: number
    ongoing_live_matches: number
    ongoing_scheduled_matches: number
  }
  ongoing: OngoingEvent[]
  cron_stats: Record<string, { runs: number; ok_runs: number; datapoints: number }>
  usage: null
  recent_events: Array<{
    source: string
    status: string
    started_at: string
    duration_ms: number | null
    meta: Record<string, unknown> | null
    error_message: string | null
  }>
  fetched_at: string
}

// ── Config ────────────────────────────────────────────────────────

export interface CronTile {
  key: string
  label: string
  schedule: string
  description: string
  paused?: boolean
  pauseReason?: string
}

export const TILES: readonly CronTile[] = [
  { key: 'cron:scores', label: 'Scores', schedule: 'Every 2 min', description: 'Polls padelapi.org for live match scores, upserts point/game/set data, detects stale matches stuck as live' },
  { key: 'cron:sync-matches', label: 'Sync Matches', schedule: 'Every 1h', description: 'Syncs match metadata (players, courts, rounds) for all active tournaments from padelapi.org' },
  { key: 'cron:sync', label: 'Full Sync', schedule: 'Mon 4am UTC', description: 'Weekly full sync: tournaments, players, seasons, and FIP logos from padelapi.org' },
  { key: 'cron:rankings', label: 'Rankings', schedule: 'Daily 5am UTC', description: 'Fetches FIP official and race rankings (top 1000, men & women) from the FIP website' },
  { key: 'cron:articles', label: 'Articles', schedule: 'Hourly :40', description: 'Fetches padel news from Google News RSS feeds and FIP WordPress API, deduplicates and upserts' },
  { key: 'cron:highlights', label: 'Highlights', schedule: 'Hourly :20', description: 'Fetches recent match highlight videos from YouTube padel channels, filters duplicates' },
  { key: 'cron:fip-tournaments', label: 'FIP Tournaments', schedule: 'Retired 2026-04-28', description: 'Discovery + event-page enrichment moved to padelgod (Railway) — see tournament-discovery and fip-event-page-enricher workers. The Vercel route returns HTTP 410 Gone.', paused: true, pauseReason: 'Retired 2026-04-28 — moved to padelgod fip-event-page-enricher worker (Railway)' },
  { key: 'cron:fip-scores', label: 'FIP Scores', schedule: 'Every 2h', description: 'Polls FIP API for live match scores in FIP-sourced tournaments, upserts results', paused: true, pauseReason: 'Switched to padelapi.org for FIP tournaments — re-enable for FIP-only data' },
] as const

// ── Helpers ───────────────────────────────────────────────────────

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function statusColor(status: string): string {
  switch (status) {
    case 'ok': return '#22c55e'
    case 'partial': return '#f59e0b'
    case 'error': case 'timeout': return '#ef4444'
    default: return '#9ca3af'
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'ok': return 'OK'
    case 'partial': return 'Partial'
    case 'error': return 'Error'
    case 'timeout': return 'Timeout'
    default: return 'Unknown'
  }
}

export function statusBorder(status: string): string {
  switch (status) {
    case 'ok': return '1px solid #e5e7eb'
    case 'partial': return '1px solid #fde68a'
    case 'error': case 'timeout': return '1px solid #fecaca'
    default: return '1px solid #e5e7eb'
  }
}

export function metaSummary(source: string, meta: Record<string, unknown> | null): string {
  if (!meta) return ''
  switch (source) {
    case 'cron:scores': return `${(meta.synced as number) ?? 0} updated · ${(meta.stale as number) ?? 0} stale`
    case 'cron:sync-matches': return `${(meta.matches_synced as number) ?? 0} matches`
    case 'cron:sync': return `${(meta.tournaments_synced as number) ?? 0} tournaments · ${(meta.players_synced as number) ?? 0} players`
    case 'cron:rankings': return `Official: ${(meta.official as number) ?? 0} · Race: ${(meta.race as number) ?? 0}`
    case 'cron:articles': return `${(meta.new as number) ?? 0} new from ${(meta.sources_checked as number) ?? 0} sources`
    case 'cron:highlights': return `${(meta.new as number) ?? 0} new videos`
    case 'cron:fip-tournaments': return `${(meta.upserted as number) ?? 0} upserted · ${(meta.enriched as number) ?? 0} enriched`
    case 'cron:fip-scores': return `${(meta.matches_upserted as number) ?? 0} matches · ${(meta.active_tournaments as number) ?? 0} tournaments`
    default: return ''
  }
}

export const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'cron:scores': { bg: '#dbeafe', text: '#1e40af' },
  'cron:sync': { bg: '#d1fae5', text: '#065f46' },
  'cron:sync-matches': { bg: '#d1fae5', text: '#065f46' },
  'cron:rankings': { bg: '#fef3c7', text: '#92400e' },
  'cron:articles': { bg: '#fce7f3', text: '#9d174d' },
  'cron:highlights': { bg: '#ede9fe', text: '#5b21b6' },
  'cron:fip-tournaments': { bg: '#ccfbf1', text: '#115e59' },
  'cron:fip-scores': { bg: '#ccfbf1', text: '#115e59' },
  'relay': { bg: '#fee2e2', text: '#991b1b' },
}

// ── Shared style objects ───────────────────────────────────────────

export const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

export const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase' as const,
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

export const bigNumber: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginTop: 4,
}

export const dimText: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  marginTop: 2,
}

export const tileLabel: React.CSSProperties = {
  fontSize: 9,
  color: '#888',
  textTransform: 'uppercase' as const,
  fontWeight: 600,
}

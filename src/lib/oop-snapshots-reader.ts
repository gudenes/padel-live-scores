// src/lib/oop-snapshots-reader.ts
//
// Reads Order of Play data from padelgod.oop_snapshots (populated by
// padelgod's hourly oop-fetcher worker) and adapts it into the OopDay/OopMatch
// shape the Ops Schedule Review already consumes.
//
// Why this exists
// ----------------
// Before: /api/ops/schedule-review called `fetchOopDay()` which re-scraped
// the Crionet widget with a brittle regex parser — court names required a
// " - X" suffix (e.g. "CENTER COURT - C"), so Brussels' plain "COURT CBC"
// failed to parse and every row showed `court='Unknown'` in the UI.
//
// After: the padelgod worker parses the same widget hourly using a proper
// cheerio-based parser and stores the results here. The Ops UI reads from
// the snapshot table directly — one parser of record, no regex soup.
//
// Bonus: snapshots carry `match_widget_id` (e.g. "MD017"), which we can use
// as an exact key to link OOP entries to `public.matches` via
// `entity_external_ids` (source='crionet_widget') — stronger than the fuzzy
// surname matching the route was doing before.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OopMatch, OopPlayer } from './fip-scraper'

/** Subset of padelgod.oop_snapshots columns this module cares about. */
interface OopSnapshotRow {
  scrape_job_id: string
  tournament_id: string
  day_number: number
  category: 'men' | 'women'
  round_label: string | null
  court: string
  court_position: number | null
  scheduled_label: string | null
  team1_player1_name: string | null
  team1_player2_name: string | null
  team2_player1_name: string | null
  team2_player2_name: string | null
  match_widget_id: string | null
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired'
  captured_at: string
}

export interface ReadOopFromSnapshotsResult {
  day: number
  matches: OopMatch[]
  /** ISO timestamp of the scrape job these rows came from. Null if no snapshot exists. */
  capturedAt: string | null
  /** Number of rows in the latest snapshot (for telemetry / empty-day detection). */
  rowCount: number
}

/**
 * Convert a short widget-format player name (e.g. "L. Perez Parra") into the
 * OopPlayer shape the Schedule Review route expects. Splits on whitespace:
 * first token is the initial, remaining tokens are the surname.
 *
 * Falls back to the entire string as surname (with empty initial) if the
 * format is unexpected — downstream fuzzy matching still works in that case.
 *
 * Note: padelgod's OOP parser doesn't capture country flags, so `country` is
 * always null. Schedule Review's UI hides the country paren when null. The
 * fuzzy DB-match scoring doesn't use country either, so this is purely a
 * display change.
 */
function parsePlayerName(raw: string | null): OopPlayer {
  const txt = (raw ?? '').trim()
  if (!txt) {
    return { initial: '', surname: '', country: null, seed: null, fullDisplay: '' }
  }
  // "L. Perez Parra" → initial="L.", surname="Perez Parra"
  const firstSpace = txt.indexOf(' ')
  if (firstSpace === -1) {
    return {
      initial: '',
      surname: txt,
      country: null,
      seed: null,
      fullDisplay: txt,
    }
  }
  const initial = txt.slice(0, firstSpace).trim()
  const surname = txt.slice(firstSpace + 1).trim()
  return {
    initial,
    surname,
    country: null,
    seed: null,
    fullDisplay: txt,
  }
}

/**
 * Translate an internal round label from padelgod's OOP parser into the
 * format Schedule Review's fuzzy matcher expects. Padelgod stores what the
 * widget emits ("Q1", "R32", "F"); the existing matcher normalises
 * "Round of 32" / "Quarterfinals" etc. We pass through whatever the parser
 * stored — the matcher tokenises both sides, so "R32" and "Round of 32" will
 * cross-match via token overlap.
 */
function normalizeRoundLabel(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Read the latest OOP snapshot for a tournament+day from
 * `padelgod.oop_snapshots` and adapt it into the OopDay shape the Schedule
 * Review route consumes. "Latest" means: the most recent `scrape_job_id` for
 * `(tournament_id, day_number)` — a single scrape run captures every match
 * on that day atomically.
 *
 * Returns `{ day, matches: [], capturedAt: null, rowCount: 0 }` when no
 * snapshot exists (padelgod hasn't run yet, or the widget returned empty).
 *
 * Ordering: matches are returned sorted by (court, court_position) so the
 * Schedule Review UI sees them in the same order as the widget's columns.
 */
export async function readOopFromSnapshots(
  supabase: SupabaseClient,
  tournamentId: string,
  dayNumber: number,
): Promise<ReadOopFromSnapshotsResult> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'scrape_job_id, tournament_id, day_number, category, round_label, court, court_position, scheduled_label, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, match_widget_id, status, captured_at',
    )
    .eq('tournament_id', tournamentId)
    .eq('day_number', dayNumber)
    .order('captured_at', { ascending: false })

  if (error) {
    throw new Error(`oop_snapshots read failed: ${error.message}`)
  }

  const rows = (data ?? []) as OopSnapshotRow[]
  if (rows.length === 0) {
    return { day: dayNumber, matches: [], capturedAt: null, rowCount: 0 }
  }

  // Keep only rows from the latest scrape_job — a single scrape captures all
  // matches for that tournament+day atomically, so older jobs are superseded.
  const latestJobId = rows[0]!.scrape_job_id
  const latest = rows.filter((r) => r.scrape_job_id === latestJobId)

  // Sort by (court, court_position) for stable display order. Unknown
  // court_position (null) sorts last within its court.
  latest.sort((a, b) => {
    if (a.court !== b.court) return a.court.localeCompare(b.court)
    const ap = a.court_position ?? Number.MAX_SAFE_INTEGER
    const bp = b.court_position ?? Number.MAX_SAFE_INTEGER
    return ap - bp
  })

  const matches: OopMatch[] = latest.map((r) => {
    const team1: [OopPlayer, OopPlayer] = [
      parsePlayerName(r.team1_player1_name),
      parsePlayerName(r.team1_player2_name),
    ]
    const team2: [OopPlayer, OopPlayer] = [
      parsePlayerName(r.team2_player1_name),
      parsePlayerName(r.team2_player2_name),
    ]
    return {
      court: r.court,
      scheduleLabel: r.scheduled_label ?? '',
      team1,
      team2,
      category: r.category,
      round: normalizeRoundLabel(r.round_label),
      matchCode: r.match_widget_id,
    }
  })

  return {
    day: dayNumber,
    matches,
    capturedAt: rows[0]!.captured_at,
    rowCount: latest.length,
  }
}

/**
 * Look up canonical `public.matches.id` values for a batch of Crionet widget
 * ids. The composite format is `{tournamentWidgetId}:{matchWidgetId}` (e.g.
 * "FIP-2026-1701:MD017").
 *
 * Two-tier lookup:
 *   1. `entity_external_ids` (source='crionet_widget') — populated by the
 *      live poller / static reconciler / match-identifier. Authoritative
 *      when present.
 *   2. `matches.widget_id_composite` — populator-owned rows (created by
 *      `fip-draw-populator`) carry the composite in this hot column but
 *      aren't registered in the sidecar until live polling fires. Only
 *      consulted when caller passes `tournamentId`, so the column lookup
 *      is scoped to one tournament and can't accidentally hijack a sibling
 *      tournament's stray row that shares a composite. Mirrors padelgod's
 *      `match-identifier.ts` step 2.
 *
 * Returns a Map from match widget id (e.g. "MD017") to match UUID for
 * entries found. Entries not found are absent from the map — callers
 * should fall back to fuzzy name matching for those.
 */
export async function lookupMatchesByWidgetIds(
  supabase: SupabaseClient,
  tournamentWidgetId: string,
  matchWidgetIds: string[],
  options?: { tournamentId?: string | null },
): Promise<Map<string, string>> {
  if (matchWidgetIds.length === 0) return new Map()

  const composites = matchWidgetIds.map(
    (id) => `${tournamentWidgetId}:${id}`,
  )

  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .in('external_id', composites)

  if (error) {
    throw new Error(`entity_external_ids widget-id lookup failed: ${error.message}`)
  }

  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ entity_id: string; external_id: string }>) {
    // external_id = "FIP-2026-1701:MD017" → extract the part after the colon
    const colonIdx = row.external_id.indexOf(':')
    if (colonIdx < 0) continue
    const matchWidgetId = row.external_id.slice(colonIdx + 1)
    if (matchWidgetId) {
      out.set(matchWidgetId, row.entity_id)
    }
  }

  // Tier 2: fall back to matches.widget_id_composite for widget ids not
  // resolved via the sidecar. Scoped to `tournamentId` so a stray row
  // in a sibling tournament that happens to share a composite can't
  // hijack the mapping. Without tournamentId we skip this tier entirely
  // — legacy callers stay on the sidecar-only behaviour.
  const tournamentId = options?.tournamentId
  if (tournamentId) {
    const missing = matchWidgetIds.filter((id) => !out.has(id))
    if (missing.length > 0) {
      const missingComposites = missing.map((id) => `${tournamentWidgetId}:${id}`)
      const { data: colRows, error: colErr } = await supabase
        .from('matches')
        .select('id, widget_id_composite')
        .eq('tournament_id', tournamentId)
        .in('widget_id_composite', missingComposites)
      if (colErr) {
        throw new Error(`matches widget_id_composite lookup failed: ${colErr.message}`)
      }
      for (const row of (colRows ?? []) as Array<{ id: string; widget_id_composite: string }>) {
        const colonIdx = row.widget_id_composite.indexOf(':')
        if (colonIdx < 0) continue
        const matchWidgetId = row.widget_id_composite.slice(colonIdx + 1)
        // Defensive: only fill in if still missing (sidecar always wins).
        if (matchWidgetId && !out.has(matchWidgetId)) {
          out.set(matchWidgetId, row.id)
        }
      }
    }
  }

  return out
}

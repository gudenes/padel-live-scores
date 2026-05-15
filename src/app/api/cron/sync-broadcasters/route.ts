// src/app/api/cron/sync-broadcasters/route.ts
//
// Weekly sync of Premier Padel broadcaster data. Pulls from two endpoints:
//   /getwheretowatchinfo  → editorial cards (YouTube R1-3, Red Bull QF→F)
//   /getwheretowatch      → per-country broadcaster listings
//
// Both feed into the broadcasters + broadcast_info tables. Rows not seen
// in this run are marked active=false (audit trail, no destructive
// deletes).
//
// Schedule: weekly (Sunday 04:00 UTC) — broadcaster deals change rarely.
// Manual trigger: GET /api/cron/sync-broadcasters with Bearer CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  broadcasterNameFromUrl,
  broadcasterIsFree,
  iso2FromFlagUrl,
} from '@/lib/broadcasters'

export const maxDuration = 60

const INFO_URL = 'https://premierpadel.com/premierpadel/api/beforeauth/getwheretowatchinfo'
const COUNTRIES_URL = 'https://premierpadel.com/premierpadel/api/beforeauth/getwheretowatch'
const SOURCE = 'premier_padel_api'

// ── API response types ─────────────────────────────────────────

interface InfoEntry {
  where_to_watch_info_id: number
  title: string | null
  description: string | null
  image: string | null
  broadcast_url: string
  display_order: number | null
  status: string
}

interface InfoResponse {
  status: number
  data: InfoEntry[]
}

interface BroadcasterEntry {
  where_to_watch_id: number
  tournaments_id: number
  type: string
  image: string | null
  broadcast_url: string
  status: string
  created_at: string | null
  updated_at: string | null
}

interface CountryEntry {
  countries_id: number
  countries_name: string | null
  countries_image: string | null
  where_to_watch: BroadcasterEntry[]
}

interface CountriesResponse {
  status: number
  all: BroadcasterEntry[]
  data: CountryEntry[]
}

// ── Sync handler ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Auth — same pattern as other crons
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return await logOpsEvent('cron:sync-broadcasters', async () => {
    const supabase = createServerClient()
    const fetchedAt = new Date().toISOString()

    const { data: ppChannel } = await supabase
      .from('youtube_channels')
      .select('id')
      .eq('abbreviation', 'PP')
      .maybeSingle()
    const premierPadelChannelId = ppChannel?.id ?? null
    if (!premierPadelChannelId) {
      console.warn('[sync-broadcasters] PP youtube_channel not found — broadcaster rows will have channel_id=NULL')
    }

    // ── Fetch both endpoints in parallel ──────────────────────
    const [infoRes, countriesRes] = await Promise.all([
      fetch(INFO_URL, { headers: { Accept: 'application/json' } }),
      fetch(COUNTRIES_URL, { headers: { Accept: 'application/json' } }),
    ])

    if (!infoRes.ok) {
      throw new Error(`info endpoint returned ${infoRes.status}`)
    }
    if (!countriesRes.ok) {
      throw new Error(`countries endpoint returned ${countriesRes.status}`)
    }

    const info = (await infoRes.json()) as InfoResponse
    const countries = (await countriesRes.json()) as CountriesResponse

    // ── Phase 1: broadcast_info (the 2 editorial cards) ──────
    const infoRows = (info.data ?? [])
      .filter(e => e.status === 'Active')
      .map(e => ({
        source: SOURCE,
        external_id: e.where_to_watch_info_id,
        title: e.title ?? '',
        description: e.description,
        url: e.broadcast_url,
        logo_url: e.image,
        display_order: e.display_order ?? 100,
        active: true,
        fetched_at: fetchedAt,
      }))

    let infoUpserted = 0
    if (infoRows.length > 0) {
      const { error } = await supabase
        .from('broadcast_info')
        .upsert(infoRows, { onConflict: 'source,external_id' })
      if (error) throw new Error(`broadcast_info upsert: ${error.message}`)
      infoUpserted = infoRows.length
    }

    // Mark info rows that weren't in this fetch as inactive
    const seenInfoIds = infoRows.map(r => r.external_id)
    const { error: infoDeactivateErr } = await supabase
      .from('broadcast_info')
      .update({ active: false })
      .eq('source', SOURCE)
      .not('external_id', 'in', `(${seenInfoIds.join(',') || '0'})`)
    if (infoDeactivateErr) {
      console.warn('[sync-broadcasters] info deactivate error:', infoDeactivateErr.message)
    }

    // ── Phase 2: broadcasters (country × broadcaster) ────────
    // Build deduped row set keyed by (external_id, country_iso2). The
    // API has duplicates because the same broadcaster appears in both
    // the `all` array AND the per-country `data` array.
    const broadcasterRows = new Map<string, ReturnType<typeof buildRow>>()

    function buildRow(
      entry: BroadcasterEntry,
      countryIso2: string,
      countryName: string | null
    ) {
      return {
        source: SOURCE,
        external_id: entry.where_to_watch_id,
        country_iso2: countryIso2,
        country_name: countryName,
        name: broadcasterNameFromUrl(entry.broadcast_url),
        url: entry.broadcast_url,
        logo_url: entry.image,
        is_free: broadcasterIsFree(entry.broadcast_url),
        display_order: 100,
        active: true,
        fetched_at: fetchedAt,
        channel_id: premierPadelChannelId,
      }
    }

    let skippedNoCountry = 0
    let skippedInactive = 0
    for (const country of countries.data ?? []) {
      const iso2 = iso2FromFlagUrl(country.countries_image)
      if (!iso2) {
        skippedNoCountry++
        continue
      }
      for (const entry of country.where_to_watch ?? []) {
        if (entry.status !== 'Active') {
          skippedInactive++
          continue
        }
        const key = `${entry.where_to_watch_id}:${iso2}`
        if (!broadcasterRows.has(key)) {
          broadcasterRows.set(key, buildRow(entry, iso2, country.countries_name))
        }
      }
    }

    const rowsArray = [...broadcasterRows.values()]
    let broadcastersUpserted = 0
    if (rowsArray.length > 0) {
      // Chunk to stay safely under any insert size limits
      const CHUNK = 500
      for (let i = 0; i < rowsArray.length; i += CHUNK) {
        const chunk = rowsArray.slice(i, i + CHUNK)
        const { error } = await supabase
          .from('broadcasters')
          .upsert(chunk, { onConflict: 'source,external_id,country_iso2' })
        if (error) throw new Error(`broadcasters upsert chunk ${i}: ${error.message}`)
        broadcastersUpserted += chunk.length
      }
    }

    // Mark broadcaster rows not seen this run as inactive. We can't easily
    // filter by composite key in a single update, so we use the audit
    // trail: rows whose fetched_at is older than the current run's
    // timestamp must be stale (the upsert above refreshed fetched_at on
    // every row that's still present in the API).
    if (rowsArray.length > 0) {
      const { error: deactivateErr } = await supabase
        .from('broadcasters')
        .update({ active: false })
        .eq('source', SOURCE)
        .lt('fetched_at', fetchedAt)
      if (deactivateErr) {
        console.warn('[sync-broadcasters] broadcaster deactivate error:', deactivateErr.message)
      }
    }

    return {
      info: {
        upserted: infoUpserted,
      },
      broadcasters: {
        upserted: broadcastersUpserted,
        countriesProcessed: countries.data?.length ?? 0,
        skippedNoCountry,
        skippedInactive,
      },
      fetchedAt,
    }
  }).then(result => NextResponse.json(result))
}

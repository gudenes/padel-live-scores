// Re-run the OOP "Followed by" parser against the latest snapshots and
// compare the recomputed scheduled_at against what's currently stored.
//
// Why this exists: padelgod/src/lib/oop-schedule-parser.ts had a bug
// where the chain key was court-only (no day_date), so when one OOP
// snapshot covered multiple days for the same court, "Followed by" rows
// would chain off the PREVIOUS day's last absolute time. Mendoza Q2
// MQ008 ended up stored as 22:15 ARG (Apr 29) when the truth was 16:30
// ARG (Apr 30) — a 5h45m drift.
//
// The parser fix is in padelgod (per-day chain isolation), but this
// script rewrites already-bad data sitting in matches.scheduled_at.
//
// Defaults to dry-run. Pass --apply to mutate.
//
// Run: node scripts/reconcile-oop-scheduled-at.mjs [--apply] [--tournament=<uuid>]

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

// ──────────────────────────────────────────────────────────────────────
// Inline parser — mirrors padelgod/src/lib/oop-schedule-parser.ts
// (post-fix). Inlined so this script doesn't need the padelgod build.
// ──────────────────────────────────────────────────────────────────────

const FOLLOWED_BY_GAP_MINUTES = 90
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/i

function localTimeToUtc(dateStr, hours, minutes, timezone) {
  try {
    const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
    if (!y || !m || !d) return null
    const asIfUtc = Date.UTC(y, m - 1, d, hours, minutes, 0)
    const probe = new Date(asIfUtc)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(probe)
    const get = type => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)
    const lY = get('year'), lM = get('month'), lD = get('day')
    let lH = get('hour'); const lMin = get('minute')
    if (lH === 24) lH = 0
    const wallClockInTz = Date.UTC(lY, lM - 1, lD, lH, lMin, 0)
    const offsetMs = wallClockInTz - asIfUtc
    return new Date(asIfUtc - offsetMs).toISOString()
  } catch { return null }
}

function parseOopScheduledAtBatch(rows, timezone) {
  const sorted = [...rows].sort((a, b) => {
    const ac = a.court ?? '', bc = b.court ?? ''
    if (ac !== bc) return ac < bc ? -1 : 1
    const ad = a.dayDate ?? '', bd = b.dayDate ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.courtPosition - b.courtPosition
  })

  const lastTimePerCourt = new Map()
  const out = []

  for (const row of sorted) {
    if (!row.matchWidgetId || !row.dayDate || !row.scheduledLabel) continue
    const courtKey = `${row.court ?? '__none__'}::${row.dayDate}`

    let scheduledAt = null
    let approximate = false

    const timeMatch = TIME_RE.exec(row.scheduledLabel)
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10)
      const minutes = parseInt(timeMatch[2], 10)
      const ampm = timeMatch[3].toUpperCase()
      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0
      scheduledAt = localTimeToUtc(row.dayDate, hours, minutes, timezone)
      if (scheduledAt) lastTimePerCourt.set(courtKey, new Date(scheduledAt))
      approximate = /not before/i.test(row.scheduledLabel)
    } else if (/followed by/i.test(row.scheduledLabel)) {
      const lastTime = lastTimePerCourt.get(courtKey)
      if (lastTime) {
        const estimated = new Date(lastTime.getTime() + FOLLOWED_BY_GAP_MINUTES * 60 * 1000)
        scheduledAt = estimated.toISOString()
        lastTimePerCourt.set(courtKey, estimated)
        approximate = true
      }
    }

    if (!scheduledAt) continue
    out.push({
      matchWidgetId: row.matchWidgetId,
      scheduledAt,
      scheduleLabel: row.scheduledLabel,
      approximate,
    })
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Reconcile loop
// ──────────────────────────────────────────────────────────────────────

async function main() {
  await loadEnv()
  const apply = process.argv.includes('--apply')
  const tournamentArg = process.argv.find(a => a.startsWith('--tournament='))
  const onlyTournament = tournamentArg ? tournamentArg.split('=')[1] : null

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Reconciling OOP scheduled_at across active tournaments…\n`)

  // 1. Latest OOP snapshot per (tournament, match_widget_id) within last 14 days
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()
  let oopQ = s
    .schema('padelgod')
    .from('oop_snapshots')
    .select('tournament_id, match_widget_id, court, court_position, scheduled_label, day_date, captured_at')
    .gte('captured_at', cutoff)
    .order('captured_at', { ascending: false })
  if (onlyTournament) oopQ = oopQ.eq('tournament_id', onlyTournament)
  const { data: oopRows, error: oopErr } = await oopQ
  if (oopErr) throw oopErr

  // 2. Dedupe to latest per (tournament, widget)
  const latest = new Map()
  for (const r of oopRows ?? []) {
    if (!r.match_widget_id) continue
    const key = `${r.tournament_id}::${r.match_widget_id}`
    if (!latest.has(key)) latest.set(key, r)
  }
  console.log(`Latest OOP rows (active tournaments): ${latest.size}`)

  // 3. Group by tournament for parser invocation (parser is per-tournament-tz)
  const byTournament = new Map()
  for (const r of latest.values()) {
    if (!byTournament.has(r.tournament_id)) byTournament.set(r.tournament_id, [])
    byTournament.get(r.tournament_id).push(r)
  }

  // 4. Pull tournament metadata (timezone + name)
  const tournamentIds = [...byTournament.keys()]
  const { data: tournaments } = await s
    .from('tournaments')
    .select('id, name, timezone, country')
    .in('id', tournamentIds)
  const tourMeta = new Map((tournaments ?? []).map(t => [t.id, t]))

  // 5. Pull active widget id per tournament for composite lookups
  const { data: widgets } = await s
    .schema('padelgod')
    .from('widget_id_cache')
    .select('tournament_id, widget_id')
    .in('tournament_id', tournamentIds)
    .eq('is_active', true)
  const widgetByTour = new Map((widgets ?? []).map(w => [w.tournament_id, w.widget_id]))

  // 6. For each tournament, parse with the new logic and compare
  const updates = []
  let totalMatches = 0
  let driftedTournaments = 0
  for (const [tid, rows] of byTournament) {
    const meta = tourMeta.get(tid)
    if (!meta?.timezone) continue
    const tw = widgetByTour.get(tid)
    if (!tw) continue

    const parsed = parseOopScheduledAtBatch(
      rows.map(r => ({
        matchWidgetId: r.match_widget_id,
        court: r.court,
        courtPosition: r.court_position ?? 0,
        scheduledLabel: r.scheduled_label,
        dayDate: r.day_date,
      })),
      meta.timezone,
    )
    if (parsed.length === 0) continue

    // Read existing matches via composite
    const composites = parsed.map(p => `${tw}:${p.matchWidgetId}`)
    const existing = []
    for (let i = 0; i < composites.length; i += 200) {
      const chunk = composites.slice(i, i + 200)
      const { data, error } = await s
        .from('matches')
        .select('id, widget_id_composite, scheduled_at, schedule_label, status, round, court')
        .in('widget_id_composite', chunk)
      if (error) throw error
      existing.push(...(data ?? []))
    }
    const existingByComp = new Map(existing.map(m => [m.widget_id_composite, m]))

    let tourDrift = 0
    for (const p of parsed) {
      const composite = `${tw}:${p.matchWidgetId}`
      const m = existingByComp.get(composite)
      if (!m) continue
      // Compare to nearest minute (avoids spurious diff on sub-second rounding)
      const cur = m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null
      const nxt = new Date(p.scheduledAt).toISOString()
      if (cur === nxt) continue
      // Don't overwrite finished matches — their scheduled_at is historical context
      if (['finished', 'retired', 'walkover', 'ended'].includes(m.status)) continue
      updates.push({
        matchId: m.id,
        composite,
        tournamentName: meta.name,
        country: meta.country,
        round: m.round,
        court: m.court,
        from: cur,
        to: nxt,
        scheduleLabel: p.scheduleLabel,
        approximate: p.approximate,
      })
      tourDrift++
    }
    totalMatches += parsed.length
    if (tourDrift > 0) driftedTournaments++
  }

  console.log(`Considered ${totalMatches} matches across ${byTournament.size} tournaments.`)
  console.log(`Drifted: ${updates.length} matches across ${driftedTournaments} tournaments.\n`)

  // 7. Group + render diff
  const byTour = new Map()
  for (const u of updates) {
    if (!byTour.has(u.tournamentName)) byTour.set(u.tournamentName, [])
    byTour.get(u.tournamentName).push(u)
  }
  const sortedTours = [...byTour.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [name, list] of sortedTours) {
    console.log(`⚠ ${name}  (${list.length} mismatches)`)
    for (const u of list.slice(0, 6)) {
      const fromShort = u.from ? u.from.slice(0, 16).replace('T', ' ') : 'null'
      const toShort = u.to.slice(0, 16).replace('T', ' ')
      console.log(`  ${u.round?.padEnd(4)} ${(u.court ?? '?').padEnd(16)} ${fromShort} → ${toShort}  [${u.scheduleLabel}]`)
    }
    if (list.length > 6) console.log(`    …and ${list.length - 6} more`)
  }
  console.log()

  if (!apply) {
    console.log('[DRY RUN] No writes. Re-run with --apply to fix.')
    return
  }

  // 8. Apply
  let ok = 0, failed = 0
  for (const u of updates) {
    const { error } = await s
      .from('matches')
      .update({ scheduled_at: u.to, schedule_label: u.scheduleLabel })
      .eq('id', u.matchId)
    if (error) { console.log(`  ✗ ${u.matchId}: ${error.message}`); failed++ }
    else ok++
  }
  console.log(`\nDone. updated=${ok} failed=${failed}`)
}

main().catch(e => { console.error(e); process.exit(1) })

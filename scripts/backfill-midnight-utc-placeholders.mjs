// One-off backfill: replace midnight-UTC scheduled_at placeholders on
// FIP-tier matches with the OOP-derived real time. Mirrors the writer's
// new gap-fill predicate (NULL OR placeholder) and CAS guard. Once
// fip-oop-writer runs on the next :52 cycle this becomes a no-op, but
// running here surfaces the fix immediately for users.

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

const FOLLOWED_BY_GAP_MINUTES = 90
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/i

function isPlaceholderScheduledAt(value) {
  if (!value) return false
  return /T00:00:00(?:\.0+)?(?:Z|[+-]00:00)?$/.test(value)
}

function localTimeToUtc(dateStr, hours, minutes, timezone) {
  try {
    const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
    if (!y || !m || !d) return null
    const asIfUtc = Date.UTC(y, m - 1, d, hours, minutes, 0)
    const probe = new Date(asIfUtc)
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    const parts = fmt.formatToParts(probe)
    const get = (type) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)
    let lH = get('hour'); if (lH === 24) lH = 0
    const wallClockInTz = Date.UTC(get('year'), get('month') - 1, get('day'), lH, get('minute'), 0)
    const offsetMs = wallClockInTz - asIfUtc
    return new Date(asIfUtc - offsetMs).toISOString()
  } catch { return null }
}

function parseOopBatch(rows, timezone) {
  const sorted = [...rows].sort((a, b) => {
    const ac = a.court ?? '', bc = b.court ?? ''
    if (ac !== bc) return ac < bc ? -1 : 1
    const ad = a.dayDate ?? '', bd = b.dayDate ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.courtPosition - b.courtPosition
  })
  const last = new Map()
  const out = []
  for (const row of sorted) {
    if (!row.matchWidgetId || !row.dayDate || !row.scheduledLabel) continue
    const courtKey = `${row.court ?? '__none__'}::${row.dayDate}`
    let scheduledAt = null, approximate = false
    const tm = TIME_RE.exec(row.scheduledLabel)
    if (tm) {
      let hours = parseInt(tm[1], 10); const minutes = parseInt(tm[2], 10); const ampm = tm[3].toUpperCase()
      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0
      scheduledAt = localTimeToUtc(row.dayDate, hours, minutes, timezone)
      if (scheduledAt) last.set(courtKey, new Date(scheduledAt))
      approximate = /not before/i.test(row.scheduledLabel)
    } else if (/followed by/i.test(row.scheduledLabel)) {
      const lt = last.get(courtKey)
      if (lt) {
        const est = new Date(lt.getTime() + FOLLOWED_BY_GAP_MINUTES * 60 * 1000)
        scheduledAt = est.toISOString()
        last.set(courtKey, est)
        approximate = true
      }
    }
    if (!scheduledAt) continue
    out.push({ matchWidgetId: row.matchWidgetId, scheduledAt, scheduleLabel: row.scheduledLabel, approximate })
  }
  return out
}

await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const apply = process.argv.includes('--apply')

// Country fallback table (mirrors fip-oop-writer's COUNTRY_TIMEZONES).
const COUNTRY_TZ = {
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IT: 'Europe/Rome', AR: 'America/Argentina/Buenos_Aires',
  CY: 'Asia/Nicosia', SG: 'Asia/Singapore', BO: 'America/La_Paz', MY: 'Asia/Kuala_Lumpur',
}

const today = new Date().toISOString().slice(0, 10)
const { data: tournaments } = await sb.from('tournaments')
  .select('id, name, level, country, timezone')
  .lte('starts_at', today).gte('ends_at', today)
  .like('level', 'fip_%')

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Backfill across ${tournaments?.length ?? 0} live FIP-tier tournaments\n`)

const totals = { tournaments: 0, candidates: 0, written: 0, parserMissed: 0, casFailed: 0 }

for (const t of tournaments ?? []) {
  // Find placeholder rows in this tournament
  const { data: rows } = await sb.from('matches')
    .select('id, scheduled_at, schedule_label, widget_id_composite')
    .eq('tournament_id', t.id)
    .not('widget_id_composite', 'is', null)
    .not('scheduled_at', 'is', null)
  const placeholders = (rows ?? []).filter(m => isPlaceholderScheduledAt(m.scheduled_at))
  if (placeholders.length === 0) continue
  totals.tournaments++
  totals.candidates += placeholders.length
  console.log(`▸ ${t.name}  (${t.country}, tz=${t.timezone ?? COUNTRY_TZ[t.country]})  — ${placeholders.length} placeholders`)

  const tz = t.timezone ?? COUNTRY_TZ[t.country]
  if (!tz) { console.log(`   ✗ no timezone resolvable, skipping`); continue }

  // Get latest OOP snapshot per match_widget_id for this tournament
  const { data: oopAll } = await sb
    .schema('padelgod')
    .from('oop_snapshots')
    .select('captured_at, match_widget_id, court, court_position, scheduled_label, day_date')
    .eq('tournament_id', t.id)
  const latestByWidget = new Map()
  for (const r of oopAll ?? []) {
    if (!r.match_widget_id) continue
    const cur = latestByWidget.get(r.match_widget_id)
    if (!cur || r.captured_at > cur.captured_at) latestByWidget.set(r.match_widget_id, r)
  }

  // Run the parser on the FULL latest batch (so chains stay intact)
  const batch = []
  for (const r of latestByWidget.values()) {
    if (!r.day_date || !r.scheduled_label) continue
    batch.push({
      matchWidgetId: r.match_widget_id,
      court: r.court,
      courtPosition: r.court_position ?? 0,
      scheduledLabel: r.scheduled_label,
      dayDate: r.day_date,
    })
  }
  const parsed = parseOopBatch(batch, tz)
  const parsedByWidget = new Map(parsed.map(p => [p.matchWidgetId, p]))

  for (const m of placeholders) {
    const widgetTail = m.widget_id_composite?.split(':').pop()
    const p = parsedByWidget.get(widgetTail)
    if (!p) {
      console.log(`   - ${widgetTail}: no parsed time available — skip`)
      totals.parserMissed++
      continue
    }
    console.log(`   ${apply ? '✓' : '·'} ${widgetTail}: ${m.scheduled_at?.slice(0,16)} → ${p.scheduledAt.slice(0,16)}  ("${p.scheduleLabel}")`)
    if (!apply) continue
    const { error } = await sb.from('matches')
      .update({ scheduled_at: p.scheduledAt, schedule_label: p.scheduleLabel })
      .eq('id', m.id)
      .eq('scheduled_at', m.scheduled_at)  // CAS: only if still the placeholder
    if (error) {
      console.log(`     ✗ ${error.message}`)
      totals.casFailed++
    } else {
      totals.written++
    }
  }
  console.log()
}

console.log('═══════════════════════════════════════════════════════════════')
console.log(`Tournaments touched:  ${totals.tournaments}`)
console.log(`Placeholder rows:     ${totals.candidates}`)
if (apply) {
  console.log(`Written:              ${totals.written}`)
  console.log(`Parser missed:        ${totals.parserMissed}`)
  console.log(`CAS failed:           ${totals.casFailed}`)
} else {
  console.log(`Parser missed:        ${totals.parserMissed}`)
  console.log('\nRe-run with --apply to commit.')
}
console.log('═══════════════════════════════════════════════════════════════')

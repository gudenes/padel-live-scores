// One-off backfill for the 3 Mendoza matches that the OLD fip-oop-writer
// stranded by feeding the parser only NULL-scheduled_at candidates.
// Loads the full latest OOP day-3 batch, runs it through the parser, and
// writes scheduled_at for the 3 specific rows that are still NULL.

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

function localTimeToUtc(dateStr, hours, minutes, timezone) {
  try {
    const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10))
    if (!y || !m || !d) return null
    const asIfUtc = Date.UTC(y, m - 1, d, hours, minutes, 0)
    const probe = new Date(asIfUtc)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(probe)
    const get = (type) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
    let lH = get('hour'); if (lH === 24) lH = 0
    const wallClockInTz = Date.UTC(get('year'), get('month') - 1, get('day'), lH, get('minute'), 0)
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
    let scheduledAt = null, approximate = false
    const tm = TIME_RE.exec(row.scheduledLabel)
    if (tm) {
      let hours = parseInt(tm[1], 10)
      const minutes = parseInt(tm[2], 10)
      const ampm = tm[3].toUpperCase()
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
    out.push({ matchWidgetId: row.matchWidgetId, scheduledAt, scheduleLabel: row.scheduledLabel, approximate })
  }
  return out
}

await loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const apply = process.argv.includes('--apply')

const T = 'bbf33680-573c-4a33-9532-092346b7bd46'
const TZ = 'America/Argentina/Buenos_Aires'

// Latest OOP snapshot day_number=3
const { data: rows } = await sb
  .schema('padelgod')
  .from('oop_snapshots')
  .select('captured_at, match_widget_id, court, court_position, scheduled_label, day_date')
  .eq('tournament_id', T)
  .eq('day_number', 3)
  .order('captured_at', { ascending: false })

const latestAt = rows?.[0]?.captured_at
const day3 = (rows ?? []).filter(r => r.captured_at === latestAt)
console.log(`Day-3 OOP rows in latest snapshot (${latestAt}): ${day3.length}\n`)

const batch = day3.map(r => ({
  matchWidgetId: r.match_widget_id,
  court: r.court,
  courtPosition: r.court_position ?? 0,
  scheduledLabel: r.scheduled_label,
  dayDate: r.day_date,
}))
const parsed = parseOopScheduledAtBatch(batch, TZ)
console.log(`Parser produced ${parsed.length} timestamps.\n`)

// Lookup the 3 missing matches by widget composite
const MISSING = ['MD028', 'MD029', 'MD023']
const { data: pubMatches } = await sb.from('matches')
  .select('id, widget_id_composite, scheduled_at, schedule_label')
  .eq('tournament_id', T)
  .or('widget_id_composite.ilike.%MD028,widget_id_composite.ilike.%MD029,widget_id_composite.ilike.%MD023')

const byWidget = new Map(parsed.map(p => [p.matchWidgetId, p]))

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Backfilling missing scheduled_at:`)
for (const m of pubMatches ?? []) {
  const tail = m.widget_id_composite?.split(':').pop()
  const p = byWidget.get(tail)
  if (!p) {
    console.log(`  ${tail}: parser returned no result — skip`)
    continue
  }
  if (m.scheduled_at != null) {
    console.log(`  ${tail}: scheduled_at already set (${m.scheduled_at}) — skip`)
    continue
  }
  console.log(`  ${tail}: NULL → ${p.scheduledAt}  ("${p.scheduleLabel}")`)
  if (apply) {
    const { error } = await sb.from('matches')
      .update({ scheduled_at: p.scheduledAt, schedule_label: p.scheduleLabel })
      .eq('id', m.id)
      .is('scheduled_at', null)
    if (error) console.log(`    ✗ ${error.message}`)
    else console.log(`    ✓ written`)
  }
}

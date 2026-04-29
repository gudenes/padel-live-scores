// One-shot: re-pull FIP event-page dates for every FIP-sourced
// tournament whose ends_at is in the future. Useful immediately
// after a parser/enricher change so users don't have to wait for
// the next hourly padelgod cron.
//
// Mirrors the logic in
//   padelgod/src/parsers/fip-event-page-detail.ts (parseEventDates)
//   padelgod/src/workers/fip-event-page-enricher.ts (overwrite-when-FIP-only)
// but inlined for a quick local run via Node + plain fetch — no
// padelgod runtime needed. After this runs, the regular hourly
// enricher takes over.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

function parseEventDates(html) {
  const dateRangeRe =
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-–—]\s*(\d{2})\/(\d{2})\/(\d{4})/
  const m = dateRangeRe.exec(html)
  if (m) {
    return {
      startsAt: `${m[3]}-${m[2]}-${m[1]}`,
      endsAt: `${m[6]}-${m[5]}-${m[4]}`,
    }
  }
  const labeled = /Main\s+draw[^\d]*(\d{2})\/(\d{2})\/(\d{4})/i.exec(html)
  if (labeled) {
    return {
      startsAt: `${labeled[3]}-${labeled[2]}-${labeled[1]}`,
      endsAt: null,
    }
  }
  return { startsAt: null, endsAt: null }
}

function fipIdToSlug(fipId) {
  if (!fipId) return null
  return fipId.startsWith('fip-') ? fipId.slice(4) : fipId
}

async function main() {
  await loadEnv()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: rows, error } = await supabase
    .from('tournaments')
    .select('id, name, slug, fip_id, source, starts_at, ends_at')
    .eq('source', 'fip')
    .gte('ends_at', cutoff)
  if (error) throw error

  console.log(`Targets: ${rows?.length ?? 0} FIP-sourced tournaments with ends_at >= ${cutoff.slice(0, 10)}\n`)

  let updated = 0
  let unchanged = 0
  let errors = 0

  for (const t of rows ?? []) {
    const slug = t.slug ?? fipIdToSlug(t.fip_id)
    if (!slug) {
      console.log(`  ✗ ${t.name}: no slug`)
      errors++
      continue
    }
    try {
      const url = `https://www.padelfip.com/events/${slug}/`
      const resp = await fetch(url, { headers: { 'User-Agent': 'PadelNachos/1.0 (refresh-fip-dates)' } })
      if (!resp.ok) {
        console.log(`  ✗ ${t.name}: HTTP ${resp.status}`)
        errors++
        continue
      }
      const html = await resp.text()
      const dates = parseEventDates(html)

      const patch = {}
      if (dates.startsAt && dates.startsAt !== (t.starts_at ?? '').slice(0, 10)) {
        patch.starts_at = dates.startsAt
      }
      if (dates.endsAt && dates.endsAt !== (t.ends_at ?? '').slice(0, 10)) {
        patch.ends_at = dates.endsAt
      }

      if (Object.keys(patch).length === 0) {
        console.log(`  · ${t.name}: dates unchanged (${(t.starts_at ?? '?').slice(0, 10)} → ${(t.ends_at ?? '?').slice(0, 10)})`)
        unchanged++
        continue
      }

      const { error: updErr } = await supabase
        .from('tournaments')
        .update(patch)
        .eq('id', t.id)
      if (updErr) {
        console.log(`  ✗ ${t.name}: update — ${updErr.message}`)
        errors++
        continue
      }
      console.log(`  ✓ ${t.name}: ${(t.starts_at ?? '?').slice(0, 10)}→${dates.startsAt ?? '·'}  /  ${(t.ends_at ?? '?').slice(0, 10)}→${dates.endsAt ?? '·'}`)
      updated++
    } catch (e) {
      console.log(`  ✗ ${t.name}: ${e.message}`)
      errors++
    }
    // Polite throttle — same as the worker.
    await new Promise(r => setTimeout(r, 250))
  }

  console.log(`\nDone. updated=${updated} unchanged=${unchanged} errors=${errors}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

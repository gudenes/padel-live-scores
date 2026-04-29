// scripts/backfill-tournament-country.ts
//
// One-shot backfill for `tournaments.country = NULL` rows that the
// padelgod tournament-discovery worker created before the country
// gap-fill (PR feat/fip-tournament-country) shipped. After that worker
// merges, future discovery passes will fill country automatically — but
// `modified_after` skips rows whose WP `modified_gmt` predates the
// most-recent updated_at, so existing rows would never get patched.
//
// Strategy:
//   1. Pull all rows where country IS NULL AND slug IS NOT NULL.
//   2. Fetch the FIP WP `country` taxonomy once (~143 terms, alpha-3 →
//      alpha-2 via the same normalizeCountry path the worker uses).
//   3. For each missing row, fetch its WP event by slug, take the first
//      country term ID, resolve to alpha-2, UPDATE the row.
//
// Source-priority for `tournament.country` is ['padelapi', 'fip'] —
// since we filter for country IS NULL, by definition padelapi never
// wrote one, so FIP is allowed to fill the gap.
//
// Usage:
//   npx tsx scripts/backfill-tournament-country.ts --dry-run
//   npx tsx scripts/backfill-tournament-country.ts
//   npx tsx scripts/backfill-tournament-country.ts --slug <slug>

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SLUG_IDX = args.indexOf('--slug')
const SLUG_FILTER = SLUG_IDX >= 0 ? args[SLUG_IDX + 1] : null

// Inline copy of the alpha-3 → alpha-2 mapping the worker uses. We read
// it from disk rather than import-ing across the padelgod boundary.
const COUNTRY_MAP: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'padelgod/src/lib/country-codes-3to2.json'),
    'utf8',
  ),
)

function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null
  const up = code.trim().toUpperCase()
  if (up.length === 0) return null
  if (up.length === 2) return up
  return COUNTRY_MAP[up] ?? null
}

interface TournamentRow {
  id: string
  slug: string
  name: string
}

interface CountryTerm {
  id: number
  name?: string
  acf?: { standard_cio?: string | null }
}

interface WpEvent {
  slug?: string
  country?: number[]
}

async function fetchCountryTaxonomy(): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  for (let page = 1; page <= 5; page++) {
    const url = `https://www.padelfip.com/wp-json/wp/v2/country?per_page=100&page=${page}`
    const r = await fetch(url)
    if (!r.ok) break
    const data = (await r.json()) as CountryTerm[]
    if (!Array.isArray(data) || data.length === 0) break
    for (const t of data) {
      if (typeof t?.id !== 'number') continue
      const cio = t.acf?.standard_cio?.trim()
      const name = t.name?.trim()
      const code = cio && cio.length > 0 ? cio : name
      out.set(t.id, normalizeCountry(code))
    }
    if (data.length < 100) break
  }
  return out
}

async function fetchEventBySlug(slug: string): Promise<WpEvent | null> {
  const url = `https://www.padelfip.com/wp-json/wp/v2/events?slug=${encodeURIComponent(slug)}`
  const r = await fetch(url)
  if (!r.ok) return null
  const data = (await r.json()) as WpEvent[]
  return Array.isArray(data) && data[0] ? data[0] : null
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Fetching tournaments with country IS NULL…`)

  let q = supabase
    .from('tournaments')
    .select('id, slug, name')
    .is('country', null)
    .not('slug', 'is', null)
    .order('starts_at', { ascending: false })

  if (SLUG_FILTER) q = q.eq('slug', SLUG_FILTER)

  const { data: rows, error } = await q
  if (error) {
    console.error('Tournaments query failed:', error.message)
    process.exit(1)
  }

  const tournaments = (rows ?? []) as TournamentRow[]
  console.log(`Found ${tournaments.length} candidate tournaments.`)
  if (tournaments.length === 0) return

  console.log('Fetching FIP country taxonomy…')
  const countryByTermId = await fetchCountryTaxonomy()
  console.log(`Loaded ${countryByTermId.size} country terms.`)

  let resolved = 0
  let skipped = 0
  let failed = 0

  for (const t of tournaments) {
    const ev = await fetchEventBySlug(t.slug)
    if (!ev || !Array.isArray(ev.country) || ev.country.length === 0) {
      console.log(`  SKIP ${t.slug} — no WP event or no country term`)
      skipped++
      continue
    }
    const alpha2 = countryByTermId.get(ev.country[0]) ?? null
    if (!alpha2) {
      console.log(`  SKIP ${t.slug} — term ${ev.country[0]} unmapped`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${t.slug} → ${alpha2}`)
      resolved++
      continue
    }

    const { error: updErr } = await supabase
      .from('tournaments')
      .update({ country: alpha2, updated_at: new Date().toISOString() })
      .eq('id', t.id)

    if (updErr) {
      console.log(`  FAIL ${t.slug} → ${alpha2}: ${updErr.message}`)
      failed++
    } else {
      console.log(`  OK   ${t.slug} → ${alpha2}`)
      resolved++
    }
  }

  console.log(`\nDone. resolved=${resolved} skipped=${skipped} failed=${failed}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

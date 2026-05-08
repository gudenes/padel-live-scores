#!/usr/bin/env npx tsx
/**
 * Tear down all seed users created by seed-fake-leaderboard.ts.
 * Identifies them by the `@padelnachos.fake` email pattern.
 * The `predictions` FK has ON DELETE CASCADE so picks are removed too.
 *
 * Usage:
 *   npx tsx scripts/clean-fake-leaderboard.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (dotenv isn't installed in this project).
const envPath = resolve(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
} catch { /* fallback to existing env */ }

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in env')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: fakeUsers, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, name')
    .like('email', '%@padelnachos.fake')

  if (fetchErr) {
    console.error('[clean] Fetch failed:', fetchErr)
    process.exit(1)
  }

  const users = fakeUsers ?? []
  if (users.length === 0) {
    console.log('[clean] No fake users found. Nothing to do.')
    return
  }

  console.log(`[clean] Found ${users.length} fake users:`)
  console.log('  ', users.slice(0, 5).map(u => u.email).join(', '), users.length > 5 ? '...' : '')

  if (dryRun) {
    console.log('[clean] DRY RUN — no deletions performed.')
    return
  }

  const ids = users.map(u => u.id)
  const { error: delErr, count } = await supabase
    .from('users')
    .delete({ count: 'exact' })
    .in('id', ids)

  if (delErr) {
    console.error('[clean] Delete failed:', delErr)
    process.exit(1)
  }

  console.log(`[clean] Deleted ${count ?? 0} fake users (predictions cascaded automatically).`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

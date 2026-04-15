// scripts/migrate-authjs-users.ts
// One-time migration: map old Supabase auth user IDs to new Auth.js user IDs.
// Run after all 3 users have signed in via Auth.js.
//
// Usage:
//   npx tsx scripts/migrate-authjs-users.ts --dry-run
//   npx tsx scripts/migrate-authjs-users.ts

import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(__dirname, '..', '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = value
  }
} catch { /* ignore if file doesn't exist */ }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Direct Postgres connection for PK updates (Supabase client can't update PKs)
function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '5432', 10),
    database: u.pathname.slice(1) || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  }
}
const pool = new Pool({
  ...parseDbUrl(process.env.DATABASE_URL ?? ''),
  max: 1,
  ssl: { rejectUnauthorized: false },
})

const DRY_RUN = process.argv.includes('--dry-run')

// Tables with user_id FK columns
const USER_TABLES = [
  'user_bookmarks',
  'user_badges',
  'match_ratings',
  'user_activity_log',
  'feature_interest',
  'push_subscriptions',
  'social_posts',
] as const

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===')

  // Get Auth.js users (matched by email)
  const { data: authjsUsers } = await supabase
    .from('users')
    .select('id, email')

  if (!authjsUsers?.length) {
    console.log('No Auth.js users found. Have users signed in yet?')
    return
  }

  // Get old profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')

  console.log('\nAuth.js users:')
  authjsUsers.forEach(u => console.log(`  ${u.email} -> ${u.id}`))
  console.log('\nExisting profiles:')
  profiles?.forEach(p => console.log(`  ${p.id} -> ${p.display_name}`))

  // ────────────────────────────────────────────────────
  // MANUAL MAPPING — fill in after checking the IDs above.
  // Run with --dry-run first to see the IDs, then fill in
  // this map and run again without --dry-run.
  // ────────────────────────────────────────────────────
  const OLD_TO_NEW: Record<string, string> = {
    'c9d2b70b-da54-4f9a-af4b-13ad3c00ade4': '3ef54558-b02e-4ab1-9e27-c9a00abe8713', // Gustavo Denes
    '589ae101-3adc-40fb-9013-0de10ccfc005': '55864441-93bc-4c02-8067-5f3d727af02b', // Lia Bressan
    // Add Luciano and Ignacio after they sign in via Auth.js:
    // '9b6061de-9754-4a8a-9ae0-21af9762556a': '<new-authjs-id>', // Luciano Tondo
    // '62bc323a-c5fd-4926-b3a9-f05e096a4cfc': '<new-authjs-id>', // Ignacio Escriva
  }

  if (Object.keys(OLD_TO_NEW).length === 0) {
    console.log('\nNo mappings defined yet.')
    console.log('1. Run with --dry-run to see the IDs above')
    console.log('2. Fill in OLD_TO_NEW map in this script')
    console.log('3. Run again without --dry-run')
    return
  }

  for (const [oldId, newId] of Object.entries(OLD_TO_NEW)) {
    console.log(`\n--- Migrating ${oldId} -> ${newId} ---`)

    // Use direct Postgres for all updates (Supabase client can't update PKs,
    // and FK constraints require profile to be renamed before child rows)
    const client = await pool.connect()
    try {
      // Step 1: Delete the auto-created Auth.js profile (empty, created on first sign-in)
      if (DRY_RUN) {
        console.log(`  [DRY] Would delete new profile ${newId} (if exists) and rename old profile ${oldId} -> ${newId}`)
      } else {
        await client.query('DELETE FROM profiles WHERE id = $1', [newId])
        // Step 2: Rename old profile PK to new Auth.js ID
        const res = await client.query('UPDATE profiles SET id = $1 WHERE id = $2', [newId, oldId])
        console.log(`  profiles: ${res.rowCount} row(s) updated`)
      }

      // Step 3: Update user_id in all related tables
      for (const table of USER_TABLES) {
        const countRes = await client.query(`SELECT COUNT(*) FROM ${table} WHERE user_id = $1`, [oldId])
        const count = parseInt(countRes.rows[0].count, 10)

        if (count > 0) {
          if (DRY_RUN) {
            console.log(`  [DRY] Would update ${count} rows in ${table}`)
          } else {
            const res = await client.query(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [newId, oldId])
            console.log(`  ${table}: updated ${res.rowCount} rows`)
          }
        }
      }
    } finally {
      client.release()
    }
  }

  console.log('\nMigration complete.')
}

main().catch(console.error).finally(() => pool.end())

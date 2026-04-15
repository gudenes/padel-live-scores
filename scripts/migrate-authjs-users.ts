// scripts/migrate-authjs-users.ts
// One-time migration: map old Supabase auth user IDs to new Auth.js user IDs.
// Run after all 3 users have signed in via Auth.js.
//
// Usage:
//   npx tsx scripts/migrate-authjs-users.ts --dry-run
//   npx tsx scripts/migrate-authjs-users.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

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
    // 'old-supabase-auth-user-id': 'new-authjs-user-id',
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

    // Update profiles.id
    if (DRY_RUN) {
      console.log(`  [DRY] Would update profiles SET id=${newId} WHERE id=${oldId}`)
    } else {
      // Must use raw SQL for PK update since Supabase client doesn't support updating PKs
      const { error } = await supabase.rpc('exec_sql', {
        sql: `UPDATE profiles SET id = '${newId}' WHERE id = '${oldId}'`
      })
      if (error) console.error(`  profiles error:`, error.message)
      else console.log(`  profiles: ok`)
    }

    // Update user_id in all related tables
    for (const table of USER_TABLES) {
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', oldId)

      if ((count ?? 0) > 0) {
        if (DRY_RUN) {
          console.log(`  [DRY] Would update ${count} rows in ${table}`)
        } else {
          const { error } = await supabase
            .from(table)
            .update({ user_id: newId })
            .eq('user_id', oldId)
          if (error) console.error(`  ${table} error:`, error.message)
          else console.log(`  ${table}: updated ${count} rows`)
        }
      }
    }
  }

  console.log('\nMigration complete.')
}

main().catch(console.error)

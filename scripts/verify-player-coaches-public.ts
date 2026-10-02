// Verifies supabase/migrations/20261002130000_player_coaches_public.sql inside a
// transaction that is ALWAYS rolled back. Nothing is committed (it briefly takes
// a lock on the coach tables). Run from the worktree root:
//   set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules npx tsx scripts/verify-player-coaches-public.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002130000_player_coaches_public.sql', 'utf8'))

    // A junk coach linked to a real player must not leak through the view.
    const player = (await c.query(`select id from players limit 1`)).rows[0].id as string
    const junk = (await c.query(
      `insert into coaches (display_name, normalized_name, slug, status) values ('Zz Junk', 'zz junk verify', 'zz-junk-verify', 'junk') returning id`,
    )).rows[0].id as string
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'Zz Junk', 9)`, [player, junk])

    await c.query('set local role anon')
    const cols = (await c.query(`select * from player_coaches_public limit 1`)).fields.map((f) => f.name).sort()
    const viewRows = (await c.query(`select count(*)::int n from player_coaches_public`)).rows[0].n as number
    const junkLeak = (await c.query(`select count(*)::int n from player_coaches_public where coach_id = $1`, [junk])).rows[0].n as number
    const coachesRows = (await c.query(`select count(*)::int n from coaches`)).rows[0].n as number
    const aliasRows = (await c.query(`select count(*)::int n from coach_aliases`)).rows[0].n as number
    const suggRows = (await c.query(`select count(*)::int n from coach_merge_suggestions`)).rows[0].n as number

    const checks = {
      exactlyFiveColumns: JSON.stringify(cols) === JSON.stringify(['coach_id', 'display_name', 'player_id', 'position', 'slug']),
      anonCanReadView: viewRows > 0,
      junkHidden: junkLeak === 0,
      coachesStillLocked: coachesRows === 0,
      aliasesStillLocked: aliasRows === 0,
      suggestionsStillLocked: suggRows === 0,
    }
    console.log({ cols, viewRows, ...checks })
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1
  } finally {
    await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(1) })

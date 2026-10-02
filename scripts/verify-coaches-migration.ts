// Verifies supabase/migrations/20261002_coaches.sql inside a transaction that is
// ALWAYS rolled back. Safe to run against prod: nothing is committed.
//   npx tsx scripts/verify-coaches-migration.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002_coaches.sql', 'utf8'))
    const ins = async (name: string) =>
      (await c.query(
        `insert into coaches (display_name, normalized_name, slug) values ($1, $2, $3) returning id`,
        [name, name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-')],
      )).rows[0].id as string
    const a = await ins('Agustin Silingo')
    const b = await ins('Agustin Gomez Silingo')
    const x = await ins('Somebody Else')
    await c.query(`insert into coach_aliases (normalized_alias, coach_id, example_raw) values ('agustin silingo', $1, 'Agustin Silingo')`, [a])
    const [lo, hi] = [a, x].sort()
    await c.query(`insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status) values ($1, $2, 1, 'subset', 'rejected')`, [lo, hi])
    await c.query(`select merge_coaches($1, $2, false)`, [a, b])

    const alias = (await c.query(`select coach_id, source from coach_aliases where normalized_alias = 'agustin silingo'`)).rows[0]
    const src = (await c.query(`select status, merged_into from coaches where id = $1`, [a])).rows[0]
    const carried = (await c.query(
      `select status from coach_merge_suggestions where coach_a = least($1::uuid, $2::uuid) and coach_b = greatest($1::uuid, $2::uuid)`, [b, x])).rows[0]
    const ok = alias.coach_id === b && alias.source === 'merge' && src.status === 'merged' && src.merged_into === b && carried?.status === 'rejected'
    console.log({ alias, src, carried, ok })
    let selfErr = ''
    try { await c.query('savepoint s'); await c.query(`select merge_coaches($1, $1)`, [b]) } catch (e) { selfErr = (e as Error).message; await c.query('rollback to savepoint s') }
    console.log({ selfMergeRejected: selfErr.includes('same coach') })
    if (!ok || !selfErr.includes('same coach')) process.exitCode = 1
  } finally {
    await c.query('rollback')
    await c.end()
  }
}
main()

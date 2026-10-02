// Verifies supabase/migrations/20261002140000_coach_rankings_public.sql in a transaction
// that is ALWAYS rolled back. Run from the worktree root:
//   set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules npx tsx scripts/verify-coach-rankings-public.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002140000_coach_rankings_public.sql', 'utf8'))

    const pros = (await c.query(`select id, points from players where coalesce(tier,'pro')='pro' and points > 0 order by points desc limit 200`)).rows as { id: string; points: number }[]
    const player = pros[0]!.id
    // two distinct pro players with different points, to assert relative rank order
    const hi = pros[0]!
    const lo = pros.find((r) => Number(r.points) < Number(hi.points))
    if (!lo) throw new Error('need two pro players with different points')
    const mk = async (name: string, status: string) =>
      (await c.query(`insert into coaches (display_name, normalized_name, slug, status) values ($1, $2, $3, $4) returning id`,
        [name, name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-'), status])).rows[0].id as string
    const junk = await mk('Zz Junk Verify', 'junk')
    const live = await mk('Zz Live Verify', 'unreviewed')
    const empty = await mk('Zz Empty Verify', 'unreviewed')
    const gone = await mk('Zz Gone Verify', 'unreviewed')
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'x', 7), ($1, $3, 'y', 8)`, [player, junk, live])
    const rHi = await mk('Zz Rank Hi Verify', 'unreviewed')
    const rLo = await mk('Zz Rank Lo Verify', 'unreviewed')
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'h', 9), ($3, $4, 'l', 9)`, [hi.id, rHi, lo.id, rLo])
    await c.query(`select merge_coaches($1, $2, false)`, [gone, live])

    const priv = (await c.query(`select
      has_table_privilege('anon','public.coach_rankings_public','SELECT') s1,
      has_table_privilege('anon','public.coach_rankings_public','INSERT') i1,
      has_table_privilege('anon','public.coach_slug_redirects','SELECT') s2,
      has_table_privilege('anon','public.coach_slug_redirects','INSERT') i2`)).rows[0]

    await c.query('set local role anon')
    const cols = (await c.query(`select * from coach_rankings_public limit 1`)).fields.map((f) => f.name).sort()
    const ids = (await c.query(`select coach_id from coach_rankings_public`)).rows.map((r) => r.coach_id as string)
    const pratto = (await c.query(`select rank_overall from coach_rankings_public where slug = 'gustavo-pratto'`)).rows[0]
    const rk = (await c.query(`select coach_id, rank_overall from coach_rankings_public where coach_id in ($1, $2)`, [rHi, rLo])).rows as { coach_id: string; rank_overall: string }[]
    const rankHi = Number(rk.find((r) => r.coach_id === rHi)?.rank_overall)
    const rankLo = Number(rk.find((r) => r.coach_id === rLo)?.rank_overall)
    const redirect = (await c.query(`select new_slug from coach_slug_redirects where old_slug = 'zz-gone-verify'`)).rows[0]

    const checks = {
      columns: JSON.stringify(cols) === JSON.stringify(['coach_id','display_name','men_points','player_count','rank_men','rank_overall','rank_women','slug','total_points','women_points']),
      liveListed: ids.includes(live),
      junkHidden: !ids.includes(junk),
      zeroPlayerHidden: !ids.includes(empty),
      mergedHidden: !ids.includes(gone),
      prattoRanked: Number(pratto?.rank_overall) >= 1,
      relativeRankOrder: rankHi >= 1 && rankHi < rankLo,
      redirectWorks: redirect?.new_slug === 'zz-live-verify',
      anonSelect: priv.s1 && priv.s2,
      anonNoInsert: !priv.i1 && !priv.i2,
    }
    console.log({ cols, ...checks })
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1
  } finally {
    await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(1) })

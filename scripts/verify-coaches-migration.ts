// Verifies supabase/migrations/20261002120000_coaches.sql inside a transaction that is
// ALWAYS rolled back, so nothing is committed. It does briefly take a lock on
// public.players (FKs) — run it off-peak. Because the migration uses
// `if not exists`, a second run against a DB where the migration is already applied
// exercises the EXISTING objects (merge_coaches is replaced inside the txn, tables are not).
//   npx tsx scripts/verify-coaches-migration.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  let began = false
  try {
    await c.connect()
    await c.query('begin')
    began = true
    await c.query(readFileSync('supabase/migrations/20261002120000_coaches.sql', 'utf8'))

    const ins = async (name: string, playerId: string | null = null) =>
      (await c.query(
        `insert into coaches (display_name, normalized_name, slug, player_id) values ($1, $2, $3, $4) returning id`,
        [name, name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-'), playerId],
      )).rows[0].id as string
    const pair = (u: string, v: string) => [u, v].sort() as [string, string]
    const expectError = async (sql: string, params: unknown[], needle: string) => {
      let msg = ''
      await c.query('savepoint e')
      try { await c.query(sql, params) } catch (e) { msg = (e as Error).message }
      await c.query('rollback to savepoint e')
      return msg.includes(needle)
    }

    const players = (await c.query(`select id from players limit 2`)).rows.map(r => r.id as string)
    if (players.length < 2) throw new Error('need at least 2 players in the DB')
    const [p1, p2] = players

    const a = await ins('Agustin Silingo')
    const b = await ins('Agustin Gomez Silingo')
    const x = await ins('Somebody Else')
    const cc = await ins('Chain Child')
    const d = await ins('Linked To P1', p1)
    const e = await ins('Linked To P2', p2)

    await c.query(`insert into coach_aliases (normalized_alias, coach_id, example_raw) values ('agustin silingo', $1, 'Agustin Silingo')`, [a])
    // Source rejected X; target already has a PENDING suggestion with X.
    await c.query(`insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status) values ($1, $2, 1, 'subset', 'rejected')`, pair(a, x))
    await c.query(`insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status) values ($1, $2, 0.8, 'typo', 'pending')`, pair(b, x))
    // Player linked to both source and target -> must dedupe to one row on target.
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'Agustin Silingo', 0), ($1, $3, 'Agustin Gomez Silingo', 1)`, [p1, a, b])
    // Rejected coach<->player link on source.
    await c.query(`insert into coach_player_link_suggestions (coach_id, player_id, status, decided_at) values ($1, $2, 'rejected', now())`, [a, p2])

    // Chain: C -> A first, then A -> B.
    await c.query(`select merge_coaches($1, $2, false)`, [cc, a])
    await c.query(`select merge_coaches($1, $2, false)`, [a, b])

    const alias = (await c.query(`select coach_id, source from coach_aliases where normalized_alias = 'agustin silingo'`)).rows[0]
    const src = (await c.query(`select status, merged_into from coaches where id = $1`, [a])).rows[0]
    const chained = (await c.query(`select status, merged_into from coaches where id = $1`, [cc])).rows[0]
    const carried = (await c.query(`select status from coach_merge_suggestions where coach_a = $1 and coach_b = $2`, pair(b, x))).rows[0]
    const mergedPair = (await c.query(`select status from coach_merge_suggestions where coach_a = $1 and coach_b = $2`, pair(a, b))).rows[0]
    const pcRows = (await c.query(`select count(*)::int as n from player_coaches where player_id = $1 and coach_id = $2`, [p1, b])).rows[0].n
    const pcSrc = (await c.query(`select count(*)::int as n from player_coaches where coach_id = $1`, [a])).rows[0].n
    const linkCarried = (await c.query(`select status from coach_player_link_suggestions where coach_id = $1 and player_id = $2`, [b, p2])).rows[0]
    const linkSrcLeft = (await c.query(`select count(*)::int as n from coach_player_link_suggestions where coach_id = $1 and status in ('pending','rejected')`, [a])).rows[0].n

    // Junk target must be refused.
    const junk = await ins('Junk Target')
    await c.query(`update coaches set status = 'junk' where id = $1`, [junk])
    const junkRejected = await expectError(`select merge_coaches($1, $2)`, [x, junk], 'junk coach')
    // Target takes source's player_id -> its other pending link suggestions become rejected.
    const t2 = await ins('Unlinked Target')
    await c.query(`insert into coach_player_link_suggestions (coach_id, player_id, status) values ($1, $2, 'pending')`, [t2, p2])
    await c.query(`select merge_coaches($1, $2, false)`, [d, t2])
    const t2Row = (await c.query(`select player_id from coaches where id = $1`, [t2])).rows[0]
    const t2Sugg = (await c.query(`select status from coach_player_link_suggestions where coach_id = $1 and player_id = $2`, [t2, p2])).rows[0]

    const checks: Record<string, boolean> = {
      mergeIntoJunkRejected: junkRejected,
      targetTookPlayer: t2Row.player_id === p1,
      otherPendingLinksRejected: t2Sugg?.status === 'rejected',
      aliasMoved: alias.coach_id === b && alias.source === 'merge',
      sourceMerged: src.status === 'merged' && src.merged_into === b,
      chainFlattened: chained.status === 'merged' && chained.merged_into === b,
      pendingFlippedToRejected: carried?.status === 'rejected',
      mergedPairRecorded: mergedPair?.status === 'merged',
      playerCoachesDeduped: pcRows === 1 && pcSrc === 0,
      rejectedLinkCarried: linkCarried?.status === 'rejected' && linkSrcLeft === 0,
      selfMergeRejected: await expectError(`select merge_coaches($1, $1)`, [b], 'same coach'),
      differentPlayersRejected: await expectError(`select merge_coaches($1, $2)`, [d, e], 'different players'),
    }
    console.log(checks)
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1
  } finally {
    if (began) await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }
}
main().catch(e => { console.error(e); process.exit(1) })

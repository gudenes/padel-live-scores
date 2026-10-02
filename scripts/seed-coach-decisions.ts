// Records coach decisions agreed with Gustavo on 2026-09-18 (memory: coach-name-dedup-rules).
//   npx tsx scripts/seed-coach-decisions.ts          # dry run: prints what it would do
//   npx tsx scripts/seed-coach-decisions.ts --apply  # writes (prod — needs go-ahead)
// Run AFTER the first non-dry coach-linker run (coaches must exist).
import { Client } from 'pg'

const MERGES: [source: string, target: string][] = [
  ['agustin silingo', 'agustin gomez silingo'],
  ['sebastian luis nerone', 'sebastian nerone'],
  ['jorge benito', 'jorge de benito'],
]
const REJECTS: [string, string][] = [
  ['juan gutierrez', 'juan jose gutierrez'],
  ['juan gutierrez', 'juan jose gutierrez vicario'],
  ['juan carlos rodriguez', 'juan manuel rodriguez'],
]

async function main() {
  const apply = process.argv.includes('--apply')
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const find = async (alias: string): Promise<{ id: string; display_name: string } | null> => {
    const r = await c.query(
      `select co.id, co.display_name from coach_aliases a join coaches co on co.id = a.coach_id
       where a.normalized_alias = $1 and co.status <> 'merged'`, [alias])
    return r.rows[0] ?? null
  }
  let mergesDone = 0, mergesSkipped = 0, rejectsDone = 0, rejectsSkipped = 0, conflicts = 0, failures = 0
  try {
    for (const [s, t] of MERGES) {
      const [src, tgt] = [await find(s), await find(t)]
      if (!src || !tgt) { console.log(`SKIP merge ${s} → ${t}: not found (${!!src}, ${!!tgt})`); mergesSkipped++; continue }
      if (src.id === tgt.id) { console.log(`SKIP merge ${s} → ${t}: already the same coach`); mergesSkipped++; continue }
      console.log(`${apply ? 'MERGE' : 'would merge'} ${src.display_name} → ${tgt.display_name}`)
      try {
        if (apply) await c.query('select merge_coaches($1, $2, false)', [src.id, tgt.id])
        mergesDone++
      } catch (e) { console.error(`FAILED merge ${s} → ${t}:`, e); failures++ }
    }
    for (const [x, y] of REJECTS) {
      const [a, b] = [await find(x), await find(y)]
      if (!a || !b) { console.log(`SKIP reject ${x} ↔ ${y}: not found (${!!a}, ${!!b})`); rejectsSkipped++; continue }
      if (a.id === b.id) {
        console.log(`CONFLICT reject ${x} ↔ ${y}: already merged into ${a.display_name} — contradicts the 2026-09-18 decision`)
        conflicts++; continue
      }
      console.log(`${apply ? 'REJECT' : 'would reject'} ${a.display_name} ↔ ${b.display_name}`)
      try {
        if (apply) await c.query(
          `insert into coach_merge_suggestions (coach_a, coach_b, score, reason, status, decided_at)
           values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 1, 'manual', 'rejected', now())
           on conflict (coach_a, coach_b) do update set status = 'rejected', decided_at = now()`, [a.id, b.id])
        rejectsDone++
      } catch (e) { console.error(`FAILED reject ${x} ↔ ${y}:`, e); failures++ }
    }
  } finally {
    await c.end()
  }
  console.log(
    `${apply ? 'APPLIED' : 'DRY RUN'}: merges ${mergesDone} ${apply ? 'done' : 'planned'}/${mergesSkipped} skipped, ` +
    `rejects ${rejectsDone} ${apply ? 'done' : 'planned'}/${rejectsSkipped} skipped, ` +
    `${conflicts} conflicts, ${failures} failed`,
  )
  if (apply && (mergesSkipped + rejectsSkipped + conflicts + failures > 0)) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })

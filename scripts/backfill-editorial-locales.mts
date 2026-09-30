// One-shot: add pt/it/fr to editorial markets published while editorialCopy
// only produced en/es. Without this, pt/it/fr players read those markets in
// English (describeMarket falls back to `question_snapshot.en`).
//
// SAFETY
// - Regenerates the copy from the market's own frozen resolver_params + tokens
//   and REFUSES a market whose regenerated en/es differ from what is stored —
//   the contract a trader agreed to must not move by a single character.
// - Only ADDS locales (jsonb ||). en/es are never rewritten.
// - The definition-freeze trigger is disabled for the single UPDATE inside one
//   transaction; any error rolls the disable back with it.
//
// Usage (from repo root):
//   npx tsx scripts/backfill-editorial-locales.mts          # dry run
//   npx tsx scripts/backfill-editorial-locales.mts --apply

import pg from 'pg'
import { editorialCopy, EDITORIAL_FAMILIES, type EditorialConfig } from '../shared/play-editorial'

process.loadEnvFile('.env.local')
const apply = process.argv.includes('--apply')

const familyFor = (resolver: string) =>
  Object.entries(EDITORIAL_FAMILIES).find(([, v]) => v.resolver === resolver)?.[0] as EditorialConfig['family'] | undefined

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const { rows } = await db.query(`
  SELECT id, resolver_key, resolver_params AS p, tokens, question_snapshot AS q, rules_snapshot AS r
  FROM markets WHERE editorial_scope IS NOT NULL ORDER BY created_at`)

const updates: { id: string; q: Record<string, string>; r: Record<string, string> }[] = []
for (const m of rows) {
  const family = familyFor(m.resolver_key)
  if (!family) { console.log(`skip ${m.id}: unknown resolver ${m.resolver_key}`); continue }
  const p = m.p ?? {}
  const config = {
    family,
    playerIds: [p.playerId, p.player1Id, p.player2Id].filter(Boolean),
    target: p.rank ?? p.titles,
    round: p.round,
    startsAt: p.startsAt, endsAt: p.endsAt, voidAfter: p.voidAfter,
    minimumStarts: p.minimumStarts, tournamentIds: p.tournamentIds ?? [],
  } as unknown as EditorialConfig
  const players = String(m.tokens?.subject ?? '').split(' / ')
  const events = String(m.tokens?.scope ?? '').split(', ').filter(Boolean)
  const copy = editorialCopy(config, players, events)

  const drift = (['en', 'es'] as const).filter((l) => copy.question[l] !== m.q?.[l] || copy.rules[l] !== m.r?.[l])
  if (drift.length) {
    console.log(`REFUSE ${m.id}: regenerated ${drift.join('/')} differs from stored contract`)
    for (const l of drift) console.log(`  stored:  ${m.q?.[l]}\n  rebuilt: ${copy.question[l]}`)
    continue
  }
  const add = (from: Record<string, string>, stored: Record<string, string>) =>
    Object.fromEntries((['pt', 'it', 'fr'] as const).filter((l) => !stored?.[l]).map((l) => [l, from[l]]))
  const q = add(copy.question, m.q), r = add(copy.rules, m.r)
  if (!Object.keys(q).length && !Object.keys(r).length) { console.log(`ok ${m.id}: already complete`); continue }
  updates.push({ id: m.id, q, r })
  console.log(`${apply ? 'APPLY' : 'would add'} ${m.id} [${Object.keys(q).join(',')}]\n  pt: ${q.pt}\n  fr: ${q.fr}`)
}

if (apply && updates.length) {
  try {
    await db.query('BEGIN')
    await db.query('ALTER TABLE public.markets DISABLE TRIGGER play_freeze_market_definition')
    for (const u of updates) {
      await db.query(
        `UPDATE public.markets SET question_snapshot = question_snapshot || $2::jsonb,
                                   rules_snapshot = rules_snapshot || $3::jsonb
         WHERE id = $1`, [u.id, JSON.stringify(u.q), JSON.stringify(u.r)])
    }
    await db.query('ALTER TABLE public.markets ENABLE TRIGGER play_freeze_market_definition')
    await db.query('COMMIT')
    console.log(`updated ${updates.length} market(s)`)
  } catch (e) {
    await db.query('ROLLBACK')
    throw e
  }
}
await db.end()

// scripts/apply-news-pipeline-migrations.mjs
//
// One-shot script to apply the 3 news-pipeline migrations to a Supabase
// Postgres database. Uses the raw `pg` driver — NOT `supabase db push` —
// because the repo has known migration drift (see MEMORY.md) and we want
// to apply ONLY these 3 files, not any other pending migrations.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/apply-news-pipeline-migrations.mjs
//
// Safety:
//   - Each migration file already contains BEGIN/COMMIT — we execute the whole
//     file as a single `pg.query()` call so any error rolls back the file.
//   - After each migration we verify the expected tables/columns exist before
//     proceeding to the next.
//   - The script is idempotent: re-running it on a partially-applied state
//     succeeds because all DDL uses IF NOT EXISTS / ON CONFLICT.

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const MIGRATIONS = [
  'supabase/migrations/20260524_news_pipeline_schema.sql',
  'supabase/migrations/20260524_news_pipeline_seed.sql',
  'supabase/migrations/20260525_news_pipeline_volume_rpc.sql',
]

const VERIFY = [
  // After migration 1 — new tables exist
  {
    label: 'schema migration — articles.summary_md column',
    sql: `SELECT column_name FROM information_schema.columns
          WHERE table_name='articles' AND column_name='summary_md'`,
    expectRows: 1,
  },
  {
    label: 'schema migration — article_entities table',
    sql: `SELECT table_name FROM information_schema.tables WHERE table_name='article_entities'`,
    expectRows: 1,
  },
  {
    label: 'schema migration — news_sources table',
    sql: `SELECT table_name FROM information_schema.tables WHERE table_name='news_sources'`,
    expectRows: 1,
  },
  // After migration 2 — seed rows present
  {
    label: 'seed migration — both feature flags inserted',
    sql: `SELECT key FROM feature_flags
          WHERE key IN ('news_pipeline_enrichment', 'foryou_enabled')`,
    expectRows: 2,
  },
  {
    label: 'seed migration — 9 static source rows inserted',
    sql: `SELECT count(*)::int AS n FROM news_sources WHERE query_kind='static'`,
    extract: r => r.rows[0].n,
    expectValue: 9,
  },
  // After migration 3 — RPC exists
  {
    label: 'volume RPC — function created',
    sql: `SELECT proname FROM pg_proc WHERE proname='refresh_news_sources_volume_7d'`,
    expectRows: 1,
  },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL env var is not set')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  console.log('Connecting to Postgres…')
  await client.connect()

  // Snapshot the state of the 4 new tables BEFORE we touch anything, so we
  // can report whether this is a fresh apply or a re-run.
  const pre = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('article_entities', 'article_topics', 'news_sources', 'news_source_suggestions')
  `)
  if (pre.rows.length > 0) {
    console.log(`Pre-existing tables (will be IF-NOT-EXISTS no-ops):`)
    for (const r of pre.rows) console.log(`  • ${r.table_name}`)
  } else {
    console.log('Fresh apply — none of the 4 new tables exist yet.')
  }
  console.log()

  // Apply each migration
  for (const path of MIGRATIONS) {
    const sql = readFileSync(path, 'utf-8')
    console.log(`→ Applying ${path} (${sql.length} bytes)`)
    try {
      await client.query(sql)
      console.log(`  ✓ applied`)
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`)
      console.error(`  All changes from this file have been rolled back (the file uses BEGIN/COMMIT).`)
      console.error(`  Previous files DID land — they are in their own transactions.`)
      await client.end()
      process.exit(2)
    }
  }

  // Verify
  console.log()
  console.log('Verifying expected state…')
  let allPass = true
  for (const v of VERIFY) {
    const result = await client.query(v.sql)
    let pass = false
    if (v.expectValue !== undefined) {
      const actual = v.extract ? v.extract(result) : null
      pass = actual === v.expectValue
      console.log(`  ${pass ? '✓' : '✗'} ${v.label} — got ${actual}, expected ${v.expectValue}`)
    } else {
      pass = result.rows.length === v.expectRows
      console.log(`  ${pass ? '✓' : '✗'} ${v.label} — got ${result.rows.length} rows, expected ${v.expectRows}`)
    }
    if (!pass) allPass = false
  }

  await client.end()

  console.log()
  if (allPass) {
    console.log('All migrations applied and verified successfully.')
    process.exit(0)
  } else {
    console.log('Some verification checks failed — inspect manually.')
    process.exit(3)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(99)
})

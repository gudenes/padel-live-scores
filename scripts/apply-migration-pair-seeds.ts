// One-shot migration applier for 20260501000001_matches_pair_seeds.sql.
// Mirrors apply-migration-day-date.ts — same justification (no
// `supabase db push` history, no psql in PATH).

import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'pg'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const SQL_PATH = 'supabase/migrations/20260501000001_matches_pair_seeds.sql'

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), SQL_PATH), 'utf8')
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    console.log(`Applying ${SQL_PATH}...`)
    await client.query(sql)
    const verify = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='matches'
       AND column_name IN ('pair1_seed','pair2_seed') ORDER BY column_name`,
    )
    if (verify.rows.length !== 2) {
      throw new Error(`expected 2 columns, got ${verify.rows.length}: ${JSON.stringify(verify.rows)}`)
    }
    console.log('OK — columns present:', verify.rows)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

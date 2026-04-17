import { Pool } from 'pg'
import fs from 'node:fs'
// Parse .env.local manually to avoid adding dotenv as a dep
const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = new URL(process.env.DATABASE_URL)
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || '5432', 10),
  database: url.pathname.slice(1),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
})
const sql = fs.readFileSync(process.argv[2], 'utf8')
try {
  await pool.query(sql)
  if (process.argv[3]) {
    const { rows } = await pool.query(
      "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name=$1",
      [process.argv[3]],
    )
    console.log('Applied. Verification:', JSON.stringify(rows[0], null, 2))
  } else {
    console.log('Applied.')
  }
} catch (e) {
  console.error('Error:', e.message)
  process.exit(1)
} finally {
  await pool.end()
}

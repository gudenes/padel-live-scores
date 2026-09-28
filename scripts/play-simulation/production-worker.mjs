import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { openSimulation, tick, heartbeat, audit } from './engine.mjs'
import { synchronize } from './synchronize.mjs'

const file = process.env.PLAY_SIMULATION_DB_PATH
if (!file?.startsWith('/data/')) throw new Error('Production simulation requires a persistent /data volume')
mkdirSync(path.dirname(file), { recursive: true })
const db = openSimulation(file)
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, global: { fetch: (url, options) => fetch(url, {...options, signal: AbortSignal.timeout(10000)}) } })
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })


try {
  if (!audit(db).ok) throw new Error('Simulation ledger audit failed')
  while (!stopping) {
    try {
      await synchronize(db, client)
      heartbeat(db)
      const result=tick(db)
      if (result.accepted) console.log('[simulation] recorded simulated trade')
    } catch {
      // Fail closed: no tick using stale source statuses after a network failure.
      console.warn('[simulation] source sync failed; no simulated trade attempted')
    }
    await sleep(5000)
  }
} finally { db.close() }

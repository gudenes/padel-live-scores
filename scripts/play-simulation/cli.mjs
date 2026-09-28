import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { openSimulation, seed, status, activity, setPaused, setIntervalMs, tick, resolve, importMarkets, audit, configure, heartbeat, LIMITS } from './engine.mjs'

// Fixed worktree-local storage. Never load .env.local or connect to Supabase.
const directory = fileURLToPath(new URL('../../.local/play-simulation/', import.meta.url))
mkdirSync(directory, { recursive: true })
const file = `${directory}simulation.sqlite`
const db = openSimulation(file)
const [command = 'status', arg, extra] = process.argv.slice(2)
const print = value => console.log(JSON.stringify(value, null, 2))
try {
  switch (command) {
    case 'admin-state': print({ ...status(db), activity: activity(db).trades, audit: audit(db), limits: LIMITS }); break
    case 'configure': configure(db, Number(arg), Number(extra)); print(status(db)); break
    case 'init': print(seed(db, arg === undefined ? 50 : Number(arg))); break
    case 'import': print(importMarkets(db, JSON.parse(readFileSync(arg, 'utf8')))); break
    case 'audit': { const report = audit(db); print(report); if (!report.ok) process.exitCode = 1; break }
    case 'status': print(status(db)); break
    case 'activity': print(activity(db)); break
    case 'pause': setPaused(db, true); print(status(db)); break
    case 'resume': setPaused(db, false); print(status(db)); break
    case 'interval': setIntervalMs(db, Number(arg)); print(status(db)); break
    case 'tick': print(tick(db)); break
    case 'resolve': print(resolve(db, arg, extra)); break
    case 'run': {
      let stopping = false
      const stop = () => { stopping = true }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      console.log('Local simulation worker. Use resume to enable trades; pause to stop them. No shared database connection.')
      while (!stopping) {
        heartbeat(db)
        const result = tick(db)
        if (!['paused', 'not_due'].includes(result.reason)) console.log(JSON.stringify(result))
        await sleep(1000)
      }
      break
    }
    default: throw new Error('Commands: init [1–1000], status, activity, audit, import <json-file>, pause, resume, interval <ms>, tick, run, resolve <marketId> <yes|no|void>')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { db.close() }

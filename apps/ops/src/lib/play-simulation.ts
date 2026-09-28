import { serviceClient } from '@/lib/supabase'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

// Next runs with apps/ops as its cwd. Keep the engine outside the Next bundle:
// it uses the local Node runtime and the same fixed database as the CLI worker.
export async function simulationCommand(args: string[]) {
  if (process.env.NODE_ENV === 'production') {
    const db = serviceClient()
    let result
    if (args[0] === 'admin-state') result = await db.rpc('play_simulation_state')
    else if (args[0] === 'pause' || args[0] === 'resume') result = await db.rpc('play_simulation_pause',{p_paused:args[0] === 'pause'})
    else if (args[0] === 'configure') result = await db.rpc('play_simulation_configure',{p_count:Number(args[1]),p_interval:Number(args[2])})
    else throw new Error('Invalid simulation command')
    if (result.error) throw new Error('Production simulation unavailable')
    return result.data
  }
  if (process.env.NODE_ENV !== 'development') throw new Error('Simulation unavailable')
  const script = path.resolve(process.cwd(), '../../scripts/play-simulation/cli.mjs')
  const { stdout } = await execute(process.execPath, [script, ...args], {
    timeout: 10000, maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

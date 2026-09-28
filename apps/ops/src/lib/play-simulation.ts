import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

// Next runs with apps/ops as its cwd. Keep the engine outside the Next bundle:
// it uses the local Node runtime and the same fixed database as the CLI worker.
export async function simulationCommand(args: string[]) {
  if (process.env.NODE_ENV !== 'development') throw new Error('Simulation controls are local-development only')
  const script = path.resolve(process.cwd(), '../../scripts/play-simulation/cli.mjs')
  const { stdout } = await execute(process.execPath, [script, ...args], {
    timeout: 10000, maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

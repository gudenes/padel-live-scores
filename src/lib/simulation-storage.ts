import path from 'node:path'

// Production is opt-in and uses a mounted Railway volume, never ephemeral disk.
export function simulationStoragePath(req: Request): string | null {
  if (process.env.NODE_ENV === 'production') {
    const file = process.env.PLAY_SIMULATION_DB_PATH
    return file?.startsWith('/data/') ? file : null
  }
  if (process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname)) return null
  return path.join(process.cwd(), '.local/play-simulation/simulation.sqlite')
}

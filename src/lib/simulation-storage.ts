import path from 'node:path'

// SQLite is only for the local pilot. Production reads Supabase.
export function simulationStoragePath(req: Request): string | null {
  if (process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname)) return null
  return path.join(process.cwd(), '.local/play-simulation/simulation.sqlite')
}

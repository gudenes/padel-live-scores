import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Exclusive per-instance lock; recover a worker that died without cleanup. */
export async function acquireRaceLock(lock: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock)
      await writeFile(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let pid: number
      try { pid = Number(await readFile(path.join(lock, 'pid'), 'utf8')) } catch {
        // Another process may be between mkdir and writing its owner record.
        try { if (Date.now() - (await stat(lock)).mtimeMs < 30_000) return false } catch { continue }
        pid = 0
      }
      if (pid > 0) {
        try { process.kill(pid, 0); return false } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
        }
      }
      await rm(lock, { recursive: true, force: true })
    }
  }
  return false
}

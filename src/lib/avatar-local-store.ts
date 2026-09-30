import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises'
import path from 'node:path'
import { AvatarGenerationError } from './avatar-generation'

const ROOT = path.join(process.cwd(), '.local', 'play-avatars')
export function avatarOwnerDirectory(userId: string) {
  return path.join(ROOT, createHash('sha256').update(userId).digest('hex'))
}
export function validAvatarId(id: string) { return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) }
export async function readLocalAvatar(userId: string, id: string) {
  if (!validAvatarId(id)) throw new AvatarGenerationError('not_found', 404)
  try { return await readFile(path.join(avatarOwnerDirectory(userId), `${id}.png`)) }
  catch { throw new AvatarGenerationError('not_found', 404) }
}
export async function saveLocalAvatar(userId: string, bytes: Uint8Array) {
  const directory = avatarOwnerDirectory(userId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  await writeFile(path.join(directory, `${id}.png`), bytes, { mode: 0o600, flag: 'wx' })
  return id
}
/** Single local process group; exclusive file lock survives hot reloads. */
export async function reserveAvatarGeneration(userId: string): Promise<() => Promise<void>> {
  const directory = avatarOwnerDirectory(userId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, 'generation.lock')
  try {
    const details = await stat(lock)
    if (Date.now() - details.mtimeMs > 10 * 60_000) await unlink(lock)
  } catch { /* no active lock */ }
  try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }) }
  catch { throw new AvatarGenerationError('generation_busy', 409) }
  const release = async () => { await unlink(lock).catch(() => {}) }
  try {
    const counter = path.join(directory, 'usage.json')
    const today = new Date().toISOString().slice(0, 10)
    let usage = { day: today, count: 0 }
    try { usage = JSON.parse(await readFile(counter, 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const count = usage.day === today ? usage.count : 0
    if (!Number.isInteger(count) || count < 0 || count >= 5) throw new AvatarGenerationError('daily_limit', 429)
    await writeFile(counter, JSON.stringify({ day: today, count: count + 1 }), { mode: 0o600 })
    return release
  } catch (error) { await release(); throw error }
}

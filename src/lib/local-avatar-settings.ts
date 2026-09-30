import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

type Settings = { enabled: boolean; apiKey: string | null }
export class LocalSettingsError extends Error {}
function directory() {
  const root = process.cwd().endsWith(path.join('apps', 'ops')) ? path.resolve(process.cwd(), '../..') : process.cwd()
  return path.join(root, '.local', 'avatar-settings')
}
async function master() {
  const dir = directory()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'master.key')
  try { await writeFile(file, randomBytes(32), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return readFile(file)
}
export async function readAvatarSettings(): Promise<Settings> {
  try {
    const data = JSON.parse(await readFile(path.join(directory(), 'settings.json'), 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', await master(), Buffer.from(data.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'))
    const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.value, 'base64')), decipher.final()]).toString('utf8'))
    return { enabled: result.enabled === true, apiKey: typeof result.apiKey === 'string' ? result.apiKey : null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false, apiKey: null }
    throw new LocalSettingsError('Could not read local avatar settings.')
  }
}
export function avatarSettingsStatus(settings: Settings) {
  return { enabled: settings.enabled, configured: !!settings.apiKey, suffix: settings.apiKey?.slice(-4) ?? null }
}
export async function writeAvatarSettings(settings: Settings) {
  const key = await master()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const value = Buffer.concat([cipher.update(JSON.stringify(settings)), cipher.final()])
  const temp = path.join(directory(), `${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: value.toString('base64') }), { mode: 0o600 })
  await rename(temp, path.join(directory(), 'settings.json'))
}

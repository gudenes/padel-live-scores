import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
export type AvatarSettings = { enabled: boolean; apiKey: string | null }
export type EncryptedAvatarKey = { iv: string; tag: string; value: string }
function master(): Buffer {
  const hex = process.env.AVATAR_SETTINGS_ENCRYPTION_KEY ?? ''
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('Avatar secret storage is unavailable.')
  return Buffer.from(hex, 'hex')
}
export function encryptAvatarKey(value: string): EncryptedAvatarKey {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', master(), iv)
  return { iv: iv.toString('base64'), value: Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}
export function decryptAvatarKey(data: EncryptedAvatarKey): string {
  const decipher = createDecipheriv('aes-256-gcm', master(), Buffer.from(data.iv,'base64'))
  decipher.setAuthTag(Buffer.from(data.tag,'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data.value,'base64')),decipher.final()]).toString('utf8')
}
export async function readProductionAvatarSettings(db: SupabaseClient): Promise<AvatarSettings> {
  master()
  const {data,error} = await db.from('avatar_provider_settings').select('enabled,encrypted_key').eq('id',true).single()
  if (error || !data) throw new Error('Avatar settings are unavailable.')
  const row = data as {enabled:boolean;encrypted_key:EncryptedAvatarKey|null}
  return { enabled: row.enabled === true, apiKey: row.encrypted_key ? decryptAvatarKey(row.encrypted_key) : null }
}
export async function writeProductionAvatarSettings(db: SupabaseClient, settings: AvatarSettings) {
  const {error} = await db.from('avatar_provider_settings').update({ enabled:settings.enabled, encrypted_key:settings.apiKey ? encryptAvatarKey(settings.apiKey) : null, updated_at:new Date().toISOString() }).eq('id',true)
  if (error) throw new Error('Could not save avatar settings.')
}

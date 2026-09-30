import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validAvatarId } from './avatar-local-store'
import { AvatarGenerationError } from './avatar-generation'
export async function reserveProductionAvatar(db: SupabaseClient, userId: string): Promise<() => Promise<void>> {
  const lease = randomUUID()
  const {data,error} = await db.rpc('reserve_avatar_generation',{p_user_id:userId,p_lease_id:lease})
  if (error) throw new AvatarGenerationError('generation_unavailable',503)
  if (data !== 'ok') throw new AvatarGenerationError(data === 'daily_limit' ? 'daily_limit' : 'generation_busy', data === 'daily_limit' ? 429 : 409)
  return async () => { const {error} = await db.rpc('release_avatar_generation',{p_user_id:userId,p_lease_id:lease}); if(error) console.warn('[avatar] lease release failed; lease will expire') }
}
export async function saveProductionAvatar(db: SupabaseClient, userId: string, bytes: Uint8Array) {
  const id = randomUUID()
  const {error} = await db.storage.from('play-avatars').upload(`${userId}/${id}.png`,bytes,{contentType:'image/png',upsert:false})
  if (error) throw new AvatarGenerationError('generation_failed',503)
  return id
}
export async function readProductionAvatar(db: SupabaseClient, userId: string, id: string) {
  if (!validAvatarId(id)) throw new AvatarGenerationError('not_found',404)
  const {data,error} = await db.storage.from('play-avatars').download(`${userId}/${id}.png`)
  if (error || !data) throw new AvatarGenerationError('not_found',404)
  return new Uint8Array(await data.arrayBuffer())
}

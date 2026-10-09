import { pgPool } from './db'

export async function isUserScouter(userId: string): Promise<boolean> {
  try {
    const result = await pgPool().query("select 1 from public.scouting_staff_grants where user_id=$1 and status='active'", [userId])
    return !!result.rowCount
  } catch (error) {
    // An additive rollout must not lock out existing administrators.
    if ((error as {code?:string}).code === '42P01') return false
    throw error
  }
}

export async function bindScoutingGrant(userId: string, verifiedByProvider = false) {
  try {
    // UUID comes from the authenticated identity. Never accept an email from the client.
    await pgPool().query(`update public.scouting_staff_grants g set user_id=u.id, updated_at=now()
      from public.users u where u.id=$1 and lower(trim(u.email))=g.email
      and (select count(*) from public.users other where lower(trim(other.email))=g.email)=1
      and (u."emailVerified" is not null or $2::boolean) and g.user_id is null and g.status='active'`, [userId, verifiedByProvider])
  } catch (error) {
    if ((error as {code?:string}).code !== '42P01') throw error
  }
}

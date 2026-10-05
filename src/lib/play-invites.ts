import {createHmac, timingSafeEqual} from 'node:crypto'

export function invitationWindow(now = Date.now()) {
 const start = Date.parse(process.env.PLAY_INVITES_START_AT ?? '')
 if (process.env.PLAY_INVITES_ENABLED !== 'true' || !Number.isFinite(start) || now < start) return null
 return {start,end:null}
}
function secret() {
 const key = process.env.AUTH_SECRET
 if (!key) throw new Error('Invitation signing unavailable')
 return key
}
export function signInvitation(issuer: string, origin: string, end: number | null = null) {
 const payload = Buffer.from(JSON.stringify({v:1,issuer,origin,end})).toString('base64url')
 return `${payload}.${createHmac('sha256',secret()).update(`play-invite:${payload}`).digest('base64url')}`
}
export function readInvitation(token: string, origin: string, now = Date.now()): {issuer:string;end:number|null}|null {
 try {
  if (token.length > 1024) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = createHmac('sha256',secret()).update(`play-invite:${payload}`).digest()
  const actual = Buffer.from(signature,'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null
  const data = JSON.parse(Buffer.from(payload,'base64url').toString())
  const window = invitationWindow(now)
  if (!window || data.v !== 1 || data.origin !== origin || (data.end !== null && (typeof data.end !== 'number' || !Number.isFinite(data.end))) || typeof data.issuer !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.issuer)) return null
  return {issuer:data.issuer,end:data.end}
 } catch {return null}
}

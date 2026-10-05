import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {invitationWindow, signInvitation} from '@/lib/play-invites'
import {playNotFound} from '../_shared'
export async function POST(req: Request) {
 const access = await requirePlayAccess()
 if (!access) return playNotFound()
 if (!isTrustedPlayWrite(req)) return Response.json({error:'invalid_origin'},{status:403})
 const window = invitationWindow()
 if (!window) return Response.json({error:'invites_unavailable'},{status:503})
 try {
  const origin = req.headers.get('origin')!
  const token = signInvitation(access.userId, origin, window.end)
  return Response.json({token,expiresAt:null},{headers:{'Cache-Control':'private, no-store'}})
 } catch {return Response.json({error:'unavailable'},{status:503})}
}

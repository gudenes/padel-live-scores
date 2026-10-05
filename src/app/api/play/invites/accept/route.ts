import {auth} from '@/auth'
import {createServiceClient} from '@/lib/supabase'
import {isPlayEnabled,isWhitelisted} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {readInvitation} from '@/lib/play-invites'
export async function POST(req: Request) {
 if (!isTrustedPlayWrite(req)) return Response.json({error:'invalid_origin'},{status:403})
 const session = await auth()
 if (!session?.user?.id) return Response.json({error:'sign_in_required'},{status:401})
 const body = await req.json().catch(()=>null)
 const invite = typeof body?.token === 'string' ? readInvitation(body.token, req.headers.get('origin')!) : null
 if (!invite) return Response.json({error:'invalid_invitation'},{status:410})
 const db = createServiceClient()
 if (!await isPlayEnabled(db) || !await isWhitelisted(db,invite.issuer)) return Response.json({error:'invalid_invitation'},{status:410})
 // The database commits access and mutual follows atomically, only on first join.
 const {error} = await db.rpc('play_accept_friend_invitation',{p_user:session.user.id,p_inviter:invite.issuer})
 if(error) return Response.json({error:'unavailable'},{status:503})
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})
}

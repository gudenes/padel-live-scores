import {createServiceClient} from '@/lib/supabase'
import {isPlayEnabled,isWhitelisted} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
import {readInvitation} from '@/lib/play-invites'
export async function POST(req: Request) {
 if (!isTrustedPlayWrite(req)) return Response.json({error:'invalid_origin'},{status:403})
 const body = await req.json().catch(()=>null)
 const invite = typeof body?.token === 'string' ? readInvitation(body.token,req.headers.get('origin')!) : null
 if (!invite) return Response.json({error:'invalid_invitation'},{status:410})
 const db = createServiceClient()
 if (!await isPlayEnabled(db) || !await isWhitelisted(db,invite.issuer)) return Response.json({error:'invalid_invitation'},{status:410})
 return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})
}

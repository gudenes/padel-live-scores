import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { previewEditorial } from '@/lib/play-editorial-service'
import { validateEditorialConfig } from '../../../../../../../shared/play-editorial'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (value: unknown, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}})
export function sameOrigin(req: Request) {
  try { const url=new URL(req.url); return req.headers.get('origin') === `${url.protocol}//${req.headers.get('host') ?? url.host}` } catch { return false }
}
export async function GET() {
  if (!(await auth())?.user?.isOperator) return json({error:'unauthorized'},401)
  const db=serviceClient()
  const [drafts,players,tournaments] = await Promise.all([
    db.from('market_editorial_drafts').select('*').order('updated_at',{ascending:false}).limit(100),
    db.from('players').select('id,name,category,ranking').not('ranking','is',null).lte('ranking',200).order('ranking').limit(500),
    db.from('tournaments').select('id,name,starts_at,ends_at,level').in('level',['p1','p2','major'])
      .gte('starts_at',new Date(Date.now()-14*86400000).toISOString()).lte('starts_at',new Date(Date.now()+180*86400000).toISOString()).order('starts_at').limit(150),
  ])
  const error=[drafts,players,tournaments].find(r=>r.error)?.error
  if(error) { console.error('[play-editorial]',error); return json({error:'Market authoring is unavailable. Check that the publishing migration has been applied.'},503) }
  return json({drafts:drafts.data,players:players.data,tournaments:tournaments.data,publishingEnabled:process.env.PLAY_EDITORIAL_PUBLISH_ENABLED==='true'})
}
export async function POST(req: Request) {
  const session=await auth()
  if (!session?.user?.isOperator) return json({error:'unauthorized'},401)
  if (!sameOrigin(req)) return json({error:'Invalid origin.'},403)
  let body: {action?:string;id?:string;revision?:number;token?:string;config?:unknown}
  try { const text=await req.text(); if(text.length>20000) return json({error:'Request too large.'},413); body=JSON.parse(text); if(!body||typeof body!=='object'||Array.isArray(body))throw Error() }
  catch { return json({error:'Invalid request.'},400) }
  const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
  if (body.id && !uuid.test(body.id)) return json({error:'Invalid draft ID.'},400)
  if (body.id && (!Number.isInteger(body.revision)||Number(body.revision)<1)) return json({error:'Missing draft revision.'},400)
  const db=serviceClient(), actor=session.user.email ?? session.user.name ?? 'operator'
  try {
    if (body.action==='save') {
      const config=validateEditorialConfig(body.config)
      const r=await db.rpc('play_save_editorial_draft',{p_id:body.id??null,p_revision:body.revision??0,p_config:config,p_actor:actor})
      if(r.error)throw Error(r.error.message)
      return json({draft:r.data})
    }
    if (!body.id || !['preview','publish'].includes(body.action??'')) return json({error:'Unknown action.'},400)
    const r=await db.from('market_editorial_drafts').select('*').eq('id',body.id).single()
    if(r.error||!r.data)return json({error:'Draft not found.'},404)
    const draft=r.data
    if (body.action==='publish' && draft.status==='published' && body.token===draft.preview_token) return json({marketId:draft.market_id})
    if(body.action==='publish' && process.env.PLAY_EDITORIAL_PUBLISH_ENABLED!=='true') return json({error:'Publishing is awaiting deployment of the matching settlement worker. Drafts and previews remain available.'},503)
    if(draft.status!=='draft'||draft.revision!==body.revision) return json({error:'This draft changed. Reload before continuing.'},409)
    const preview=await previewEditorial(db,draft.config)
    if(body.action==='preview') {
      const result=await db.rpc('play_preview_editorial_draft',{p_id:body.id,p_revision:body.revision,p_preview:preview,p_actor:actor})
      if(result.error)throw Error(result.error.message)
      return json({draft:result.data})
    }
    if(!body.token||!uuid.test(body.token))return json({error:'Preview the saved draft before publishing.'},400)
    if(preview.errors.length || preview.fingerprint!==draft.preview?.fingerprint) return json({error:'The evidence or price changed. Preview again before publishing.',details:preview.errors},409)
    const result=await db.rpc('play_publish_editorial_draft',{p_id:body.id,p_revision:body.revision,p_token:body.token,p_fingerprint:preview.fingerprint,p_actor:actor})
    if(result.error)throw Error(result.error.message)
    return json({marketId:result.data})
  } catch(error) { console.error('[play-editorial]',error); return json({error:error instanceof Error?error.message:'Could not complete the market operation.'},409) }
}

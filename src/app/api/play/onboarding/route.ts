import { requirePlayAccess } from '@/lib/play-access'
import { isTrustedPlayWrite } from '@/lib/play-write-origin'
import { canAdvance, validPublicName, type OnboardingStep } from '@/lib/play-onboarding'
import { PLAYER_FACES } from '@/lib/player-outfit'
import { playNotFound } from '../_shared'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store'}})
export async function GET() {
 const access = await requirePlayAccess()
 if (!access) return playNotFound()
 const {supabase,userId} = access
 const [{data:progress,error}, profile, wardrobe, trades] = await Promise.all([
  supabase.from('play_onboarding').select('step').eq('user_id',userId).maybeSingle(),
  supabase.from('profiles').select('display_name').eq('id',userId).single(),
  supabase.from('play_wardrobes').select('avatar').eq('user_id',userId).maybeSingle(),
  supabase.from('market_trades').select('id').eq('user_id',userId).limit(1),
 ])
 if(error || profile.error || wardrobe.error || trades.error) return json({error:'unavailable'},503)
 // Existing players retain their identity and skip introductory setup.
 return json({step:progress?.step ?? (trades.data?.length ? 'done' : 'identity'), name:profile.data?.display_name ?? '', avatar:wardrobe.data?.avatar ?? 'face-06'})
}
export async function POST(req: Request) {
 const access = await requirePlayAccess()
 if (!access) return playNotFound()
 if (!isTrustedPlayWrite(req)) return json({error:'invalid_origin'},403)
 const body = await req.json().catch(()=>null)
 if (!body) return json({error:'invalid_request'},400)
 const {supabase,userId} = access
 if (body.action === 'identity') {
  if (!validPublicName(body.name) || !PLAYER_FACES.includes(body.avatar)) return json({error:'invalid_identity'},400)
  const {error} = await supabase.rpc('play_onboarding_identity',{p_user:userId,p_name:body.name.trim(),p_avatar:body.avatar})
  return error ? json({error:'save_failed'},503) : json({ok:true})
 }
 const {data,error} = await supabase.from('play_onboarding').select('step').eq('user_id',userId).maybeSingle()
 if (error) return json({error:'save_failed'},503)
 if (data?.step === body.step && body.step === 'done') return json({ok:true})
 if (!data || !canAdvance(data.step as OnboardingStep,body.step)) return json({error:'invalid_step'},409)
 const result = await supabase.from('play_onboarding').update({step:body.step,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('step',data.step)
 return result.error ? json({error:'save_failed'},503) : json({ok:true})
}

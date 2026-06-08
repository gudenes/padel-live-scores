// src/app/api/user/plan/route.ts
// GET → { plan: 'free' | 'pro', isPro: boolean }
import { getUserOrFail } from '../_auth'
import { isPro, type Plan } from '@/lib/entitlements'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', user.id)
    .maybeSingle()
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  const plan = ((data?.plan as Plan | undefined) ?? 'free')
  const pro = isPro({ plan, plan_expires_at: (data?.plan_expires_at as string | null) ?? null })
  return Response.json({ plan: pro ? 'pro' : 'free', isPro: pro })
}

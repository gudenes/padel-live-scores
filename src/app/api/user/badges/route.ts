import {requirePlayAccess} from '@/lib/play-access'
import {BADGE_CATALOG as ORIGINAL_CATALOG} from '@/components/legacy/badges'
import { getPredictionBadgeProgress } from '@/lib/prediction-badge-progress'
import { getUserOrFail } from '../_auth'
import { BADGE_CATALOG, OG_FAN_CUTOFF, type BadgeDefinition } from '@/lib/badges'

async function getBadgeCount(
  supabase: ReturnType<typeof import('@/lib/supabase').createServiceClient>,
  userId: string,
  badge: BadgeDefinition
): Promise<number> {
  switch (badge.evalType) {
    case 'bookmark_count': {
      const { count, error } = await supabase
        .from('user_bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('bookmark_type', badge.evalParam ?? '')
      if (error) throw new Error('Badge progress unavailable')
      return count ?? 0
    }
    case 'rating_count': {
      const { count, error } = await supabase
        .from('match_ratings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw new Error('Badge progress unavailable')
      return count ?? 0
    }
    case 'activity_count': {
      const { count, error } = await supabase
        .from('user_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', badge.evalParam ?? '')
      if (error) throw new Error('Badge progress unavailable')
      return count ?? 0
    }
    case 'login_streak': {
      const { data, error } = await supabase.from('profiles').select('login_streak').eq('id', userId).single()
      if (error) throw new Error('Badge progress unavailable')
      return data?.login_streak ?? 0
    }
    case 'longest_streak': {
      const { data, error } = await supabase.from('profiles').select('longest_streak').eq('id', userId).single()
      if (error) throw new Error('Badge progress unavailable')
      return data?.longest_streak ?? 0
    }
    case 'referral_count': {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', userId)
      if (error) throw new Error('Badge progress unavailable')
      return count ?? 0
    }
    case 'profile_complete':
      return 1
    case 'early_adopter': {
      const { data, error } = await supabase.from('profiles').select('created_at').eq('id', userId).single()
      if (error) throw new Error('Badge progress unavailable')
      if (!data?.created_at) return 0
      return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
    }
    case 'feature_interest': {
      const { count, error } = await supabase.from('feature_interest').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('feature_key', badge.evalParam ?? '')
      if (error) throw new Error('Badge progress unavailable')
      return (count ?? 0) > 0 ? 1 : 0
    }
    case 'push_enabled': {
      const { count, error } = await supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      if (error) throw new Error('Badge progress unavailable')
      return (count ?? 0) > 0 ? 1 : 0
    }
    default:
      return 0
  }
}

async function getBadges(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error || !user?.id || !supabase) return error ?? Response.json({ error: 'unauthorized' }, { status: 401 })

  const userId = user.id

  const url = new URL(req.url)
  const checkUnlocks = url.searchParams.get('check_unlocks') === 'true'

  const { data: badges, error: readError } = await supabase
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', userId)

  if (readError) throw new Error('Badges unavailable')
  const withProgress = url.searchParams.get('progress') === 'true'
  if (!checkUnlocks && !withProgress) {
    return Response.json(badges ?? [])
  }

  const beta = await requirePlayAccess()
  const catalog = beta ? BADGE_CATALOG : ORIGINAL_CATALOG
  const predictions = beta ? await getPredictionBadgeProgress(supabase, userId) : {}
  const counts = Object.fromEntries(await Promise.all(catalog.map(async badge => [badge.id,
    badge.evalType in predictions ? predictions[badge.evalType as keyof typeof predictions] : await getBadgeCount(supabase, userId, badge)
  ]))) as Record<string, number>
  if (!checkUnlocks) return Response.json({ badges: badges ?? [], progress: counts }, {headers: {'Cache-Control':'private, no-store'}})

  const earned = new Map<string, Set<number>>()
  for (const b of badges ?? []) {
    if (!earned.has(b.badge_id)) earned.set(b.badge_id, new Set())
    earned.get(b.badge_id)!.add(b.tier)
  }

  const newBadges: { badge_id: string; tier: number }[] = []

  for (const badge of catalog) {
    const count = counts[badge.id]
    const alreadyEarned = earned.get(badge.id) ?? new Set()

    if (badge.isSingleTier) {
      if (count >= 1 && !alreadyEarned.has(1)) {
        const {error: insertError} = await supabase.from('user_badges').insert({ user_id: userId, badge_id: badge.id, tier: 1 })
        if (insertError && insertError.code !== '23505') throw new Error('Badge award failed')
        if (!insertError) newBadges.push({ badge_id: badge.id, tier: 1 })
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !alreadyEarned.has(t.tier)) {
          const {error: insertError} = await supabase.from('user_badges').insert({ user_id: userId, badge_id: badge.id, tier: t.tier })
          if (insertError && insertError.code !== '23505') throw new Error('Badge award failed')
          if (!insertError) newBadges.push({ badge_id: badge.id, tier: t.tier })
        }
      }
    }
  }

  const { data: allBadges, error: finalError } = await supabase
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', userId)

  if (finalError) throw new Error('Badges unavailable')
  return Response.json({ badges: allBadges ?? [], newBadges, progress: counts }, {headers: {'Cache-Control':'private, no-store'}})
}

export async function GET(req: Request) {
  try { return await getBadges(req) }
  catch { return Response.json({error:'badge_progress_unavailable'}, {status:503}) }
}

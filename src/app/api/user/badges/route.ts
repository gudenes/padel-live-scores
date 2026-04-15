import { getUserOrFail } from '../_auth'
import { BADGE_CATALOG, OG_FAN_CUTOFF, type BadgeDefinition } from '@/lib/badges'

async function getBadgeCount(
  supabase: ReturnType<typeof import('@/lib/supabase').createServiceClient>,
  userId: string,
  badge: BadgeDefinition
): Promise<number> {
  switch (badge.evalType) {
    case 'bookmark_count': {
      const { count } = await supabase
        .from('user_bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('bookmark_type', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'rating_count': {
      const { count } = await supabase
        .from('match_ratings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return count ?? 0
    }
    case 'activity_count': {
      const { count } = await supabase
        .from('user_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'login_streak': {
      const { data } = await supabase.from('profiles').select('login_streak').eq('id', userId).single()
      return data?.login_streak ?? 0
    }
    case 'longest_streak': {
      const { data } = await supabase.from('profiles').select('longest_streak').eq('id', userId).single()
      return data?.longest_streak ?? 0
    }
    case 'referral_count': {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', userId)
      return count ?? 0
    }
    case 'profile_complete':
      return 1
    case 'early_adopter': {
      const { data } = await supabase.from('profiles').select('created_at').eq('id', userId).single()
      if (!data?.created_at) return 0
      return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
    }
    case 'feature_interest': {
      const { count } = await supabase.from('feature_interest').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('feature_key', badge.evalParam ?? '')
      return (count ?? 0) > 0 ? 1 : 0
    }
    case 'push_enabled': {
      const { count } = await supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      return (count ?? 0) > 0 ? 1 : 0
    }
    default:
      return 0
  }
}

export async function GET(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error || !user?.id || !supabase) return error ?? Response.json({ error: 'unauthorized' }, { status: 401 })

  const userId = user.id

  const url = new URL(req.url)
  const checkUnlocks = url.searchParams.get('check_unlocks') === 'true'

  const { data: badges } = await supabase
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', userId)

  if (!checkUnlocks) {
    return Response.json(badges ?? [])
  }

  const earned = new Map<string, Set<number>>()
  for (const b of badges ?? []) {
    if (!earned.has(b.badge_id)) earned.set(b.badge_id, new Set())
    earned.get(b.badge_id)!.add(b.tier)
  }

  const newBadges: { badge_id: string; tier: number }[] = []

  for (const badge of BADGE_CATALOG) {
    const count = await getBadgeCount(supabase, userId, badge)
    const alreadyEarned = earned.get(badge.id) ?? new Set()

    if (badge.isSingleTier) {
      if (count >= 1 && !alreadyEarned.has(1)) {
        await supabase.from('user_badges').insert({ user_id: userId, badge_id: badge.id, tier: 1 })
        newBadges.push({ badge_id: badge.id, tier: 1 })
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !alreadyEarned.has(t.tier)) {
          await supabase.from('user_badges').insert({ user_id: userId, badge_id: badge.id, tier: t.tier })
          newBadges.push({ badge_id: badge.id, tier: t.tier })
        }
      }
    }
  }

  const { data: allBadges } = await supabase
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', userId)

  return Response.json({ badges: allBadges ?? [], newBadges })
}

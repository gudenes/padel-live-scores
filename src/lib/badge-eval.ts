// src/lib/badge-eval.ts
//
// Standalone badge count evaluator — extracted from useBadges.ts so it can be
// reused by the inline badge checker without needing a React context.

import { supabase } from '@/lib/supabase'
import { OG_FAN_CUTOFF, type BadgeDefinition } from '@/lib/badges'

/**
 * Returns the current count for a badge's eval type for the given user.
 * Pure async function — no React hooks, safe to call from anywhere.
 */
export async function getBadgeCount(userId: string, badge: BadgeDefinition): Promise<number> {
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
      const { data } = await supabase
        .from('profiles')
        .select('login_streak')
        .eq('id', userId)
        .single()
      return data?.login_streak ?? 0
    }
    case 'longest_streak': {
      const { data } = await supabase
        .from('profiles')
        .select('longest_streak')
        .eq('id', userId)
        .single()
      return data?.longest_streak ?? 0
    }
    case 'referral_count': {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('referred_by', userId)
      return count ?? 0
    }
    case 'profile_complete': {
      // Simply having an account counts — tied to sign-up, not profile fields.
      return 1
    }
    case 'early_adopter': {
      const { data } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('id', userId)
        .single()
      if (!data?.created_at) return 0
      return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
    }
    case 'feature_interest': {
      const { count } = await supabase
        .from('feature_interest')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('feature_key', badge.evalParam ?? '')
      return (count ?? 0) > 0 ? 1 : 0
    }
    case 'push_enabled': {
      const { count } = await supabase
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return (count ?? 0) > 0 ? 1 : 0
    }
    default:
      return 0
  }
}

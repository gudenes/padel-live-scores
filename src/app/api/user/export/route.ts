// src/app/api/user/export/route.ts
// GET — returns a JSON file attachment with everything we hold about the
// authenticated user. Assembles in-memory; no streaming (payload is small).
//
// Scoping discipline: every query below is bound by user_id = $userId or
// id = $userId so this endpoint can never leak another user's rows.

import { getUserOrFail } from '../_auth'
import {
  assembleExportBundle,
  formatExportFilename,
  type ExportBookmarkRow,
  type ExportBadgeRow,
  type ExportRatingRow,
  type ExportPushSubscriptionRow,
  type ExportFeatureInterestRow,
} from '@/lib/export-bundle'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  try {
    const [
      profileRes,
      authUserRes,
      accountRes,
      bookmarksRes,
      pushRes,
      badgesRes,
      ratingsRes,
      invitedRes,
      featureRes,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'id, display_name, avatar_url, preferred_country, referral_code, referred_by, marketing_opt_in, created_at'
        )
        .eq('id', user.id)
        .single(),
      supabase.from('users').select('email, "emailVerified", name, image').eq('id', user.id).single(),
      supabase.from('accounts').select('provider').eq('userId', user.id).limit(1).maybeSingle(),
      supabase
        .from('user_bookmarks')
        .select('bookmark_type, target_id, created_at')
        .eq('user_id', user.id),
      supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth, created_at')
        .eq('user_id', user.id),
      supabase
        .from('user_badges')
        .select('badge_id, tier, earned_at')
        .eq('user_id', user.id),
      supabase
        .from('match_ratings')
        .select('match_id, rating, created_at')
        .eq('user_id', user.id),
      supabase.from('profiles').select('id').eq('referred_by', user.id),
      supabase
        .from('feature_interest')
        .select('feature, created_at')
        .eq('user_id', user.id),
    ])

    if (profileRes.error) throw profileRes.error
    if (authUserRes.error) throw authUserRes.error

    const exportedAt = new Date().toISOString()
    const bundle = assembleExportBundle({
      exportedAt,
      profile: profileRes.data,
      authUser: authUserRes.data,
      accountProvider: accountRes.data?.provider ?? null,
      bookmarks: (bookmarksRes.data ?? []) as ExportBookmarkRow[],
      pushSubscriptions: (pushRes.data ?? []) as ExportPushSubscriptionRow[],
      badges: (badgesRes.data ?? []) as ExportBadgeRow[],
      ratings: (ratingsRes.data ?? []) as ExportRatingRow[],
      invitedUserIds: (invitedRes.data ?? []).map((r: { id: string }) => r.id),
      featureInterest: (featureRes.data ?? []) as ExportFeatureInterestRow[],
    })

    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${formatExportFilename(exportedAt)}"`,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'export failed'
    return Response.json({ error: message }, { status: 500 })
  }
}

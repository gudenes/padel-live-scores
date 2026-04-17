// src/lib/export-bundle.ts
// Pure assembler for GET /api/user/export. Takes already-fetched rows and
// returns the final JSON bundle shape. Keeping this pure lets us unit-test
// the redaction and shape without needing a DB.

export interface ExportProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
  referral_code: string | null
  referred_by: string | null
  marketing_opt_in: boolean
  created_at: string
}

export interface ExportAuthUserRow {
  email: string | null
  emailVerified: string | null
  name: string | null
  image: string | null
}

export interface ExportPushSubscriptionRow {
  endpoint: string
  p256dh: string | null
  auth: string | null
  created_at: string
}

export interface ExportBookmarkRow {
  bookmark_type: 'match' | 'player'
  target_id: string
  created_at: string
}

export interface ExportBadgeRow {
  badge_id: string
  tier: number
  earned_at: string
}

export interface ExportRatingRow {
  match_id: string
  rating: number
  created_at: string
}

export interface ExportFeatureInterestRow {
  feature: string
  created_at: string
}

export interface AssembleInput {
  exportedAt: string
  profile: ExportProfileRow
  authUser: ExportAuthUserRow
  accountProvider: string | null
  bookmarks: ExportBookmarkRow[]
  pushSubscriptions: ExportPushSubscriptionRow[]
  badges: ExportBadgeRow[]
  ratings: ExportRatingRow[]
  invitedUserIds: string[]
  featureInterest: ExportFeatureInterestRow[]
}

export interface UserExportBundle {
  exported_at: string
  profile: ExportProfileRow
  auth: {
    email: string | null
    provider: string
    email_verified: string | null
    name: string | null
    image: string | null
  }
  bookmarks: ExportBookmarkRow[]
  push_subscriptions: Array<{ endpoint: string; created_at: string }>
  badges: ExportBadgeRow[]
  ratings: ExportRatingRow[]
  referrals: { invited_by: string | null; invited: string[] }
  feature_interest: ExportFeatureInterestRow[]
}

export function assembleExportBundle(input: AssembleInput): UserExportBundle {
  return {
    exported_at: input.exportedAt,
    profile: input.profile,
    auth: {
      email: input.authUser.email,
      // No accounts row means this user only signed in via email magic link.
      provider: input.accountProvider ?? 'email',
      email_verified: input.authUser.emailVerified,
      name: input.authUser.name,
      image: input.authUser.image,
    },
    bookmarks: input.bookmarks,
    // Redact p256dh + auth keys — they grant push-send capability and have
    // no legitimate export use.
    push_subscriptions: input.pushSubscriptions.map(({ endpoint, created_at }) => ({
      endpoint,
      created_at,
    })),
    badges: input.badges,
    ratings: input.ratings,
    referrals: {
      invited_by: input.profile.referred_by,
      invited: input.invitedUserIds,
    },
    feature_interest: input.featureInterest,
  }
}

export function formatExportFilename(isoTimestamp: string): string {
  // UTC YYYY-MM-DD is authoritative regardless of server tz.
  const d = new Date(isoTimestamp)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `padelnachos-export-${y}-${m}-${day}.json`
}

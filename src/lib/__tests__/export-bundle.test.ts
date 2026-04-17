/**
 * export-bundle.test.ts
 *
 * Unit tests for the pure user-data export bundle assembler.
 * Run with: npx vitest run src/lib/__tests__/export-bundle.test.ts
 */

import { describe, it, expect } from 'vitest'
import { assembleExportBundle, formatExportFilename } from '../export-bundle'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const EXPORTED_AT = '2026-04-17T14:23:00.000Z'

describe('assembleExportBundle', () => {
  it('returns an empty-but-valid bundle for a user with no data', () => {
    const bundle = assembleExportBundle({
      exportedAt: EXPORTED_AT,
      profile: {
        id: USER_ID,
        display_name: null,
        avatar_url: null,
        preferred_country: null,
        referral_code: null,
        referred_by: null,
        marketing_opt_in: false,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      authUser: { email: null, emailVerified: null, name: null, image: null },
      accountProvider: null,
      bookmarks: [],
      pushSubscriptions: [],
      badges: [],
      ratings: [],
      invitedUserIds: [],
      featureInterest: [],
    })

    expect(bundle.exported_at).toBe(EXPORTED_AT)
    expect(bundle.profile.id).toBe(USER_ID)
    expect(bundle.bookmarks).toEqual([])
    expect(bundle.push_subscriptions).toEqual([])
    expect(bundle.badges).toEqual([])
    expect(bundle.ratings).toEqual([])
    expect(bundle.referrals).toEqual({ invited_by: null, invited: [] })
    expect(bundle.feature_interest).toEqual([])
  })

  it('redacts push subscription keys (p256dh, auth)', () => {
    const bundle = assembleExportBundle({
      exportedAt: EXPORTED_AT,
      profile: {
        id: USER_ID,
        display_name: 'Test',
        avatar_url: null,
        preferred_country: null,
        referral_code: null,
        referred_by: null,
        marketing_opt_in: false,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      authUser: { email: 't@example.com', emailVerified: null, name: 'Test', image: null },
      accountProvider: 'google',
      bookmarks: [],
      pushSubscriptions: [
        {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          p256dh: 'SECRET-P256DH-KEY',
          auth: 'SECRET-AUTH-KEY',
          created_at: '2026-04-05T12:00:00.000Z',
        },
      ],
      badges: [],
      ratings: [],
      invitedUserIds: [],
      featureInterest: [],
    })

    expect(bundle.push_subscriptions).toHaveLength(1)
    expect(bundle.push_subscriptions[0]).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      created_at: '2026-04-05T12:00:00.000Z',
    })
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('SECRET-P256DH-KEY')
    expect(serialized).not.toContain('SECRET-AUTH-KEY')
  })

  it('falls back to auth.provider = "email" when there is no accounts row', () => {
    const bundle = assembleExportBundle({
      exportedAt: EXPORTED_AT,
      profile: {
        id: USER_ID,
        display_name: 'Test',
        avatar_url: null,
        preferred_country: null,
        referral_code: null,
        referred_by: null,
        marketing_opt_in: false,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      authUser: { email: 't@example.com', emailVerified: null, name: 'Test', image: null },
      accountProvider: null,
      bookmarks: [],
      pushSubscriptions: [],
      badges: [],
      ratings: [],
      invitedUserIds: [],
      featureInterest: [],
    })
    expect(bundle.auth.provider).toBe('email')
  })

  it('passes through bookmarks, badges, ratings, and referrals unchanged', () => {
    const bundle = assembleExportBundle({
      exportedAt: EXPORTED_AT,
      profile: {
        id: USER_ID,
        display_name: 'Test',
        avatar_url: null,
        preferred_country: 'ES',
        referral_code: 'ABC123',
        referred_by: '22222222-2222-2222-2222-222222222222',
        marketing_opt_in: true,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      authUser: {
        email: 't@example.com',
        emailVerified: '2026-04-01T00:05:00.000Z',
        name: 'Test',
        image: null,
      },
      accountProvider: 'google',
      bookmarks: [
        { bookmark_type: 'match', target_id: 'm1', created_at: '2026-04-02T00:00:00.000Z' },
        { bookmark_type: 'player', target_id: 'p1', created_at: '2026-04-03T00:00:00.000Z' },
      ],
      pushSubscriptions: [],
      badges: [
        { badge_id: 'welcome', tier: 1, earned_at: '2026-04-01T00:10:00.000Z' },
      ],
      ratings: [
        { match_id: 'm1', rating: 4, created_at: '2026-04-04T00:00:00.000Z' },
      ],
      invitedUserIds: ['33333333-3333-3333-3333-333333333333'],
      featureInterest: [
        { feature: 'genius', created_at: '2026-04-05T00:00:00.000Z' },
      ],
    })

    expect(bundle.bookmarks).toHaveLength(2)
    expect(bundle.bookmarks[0]).toEqual({
      bookmark_type: 'match',
      target_id: 'm1',
      created_at: '2026-04-02T00:00:00.000Z',
    })
    expect(bundle.badges[0]).toEqual({
      badge_id: 'welcome',
      tier: 1,
      earned_at: '2026-04-01T00:10:00.000Z',
    })
    expect(bundle.ratings[0]).toEqual({
      match_id: 'm1',
      rating: 4,
      created_at: '2026-04-04T00:00:00.000Z',
    })
    expect(bundle.referrals.invited_by).toBe('22222222-2222-2222-2222-222222222222')
    expect(bundle.referrals.invited).toEqual(['33333333-3333-3333-3333-333333333333'])
    expect(bundle.auth.provider).toBe('google')
    expect(bundle.auth.email_verified).toBe('2026-04-01T00:05:00.000Z')
    expect(bundle.profile.marketing_opt_in).toBe(true)
  })
})

describe('formatExportFilename', () => {
  it('formats YYYY-MM-DD from an ISO string in UTC', () => {
    expect(formatExportFilename('2026-04-17T14:23:00.000Z')).toBe(
      'padelnachos-export-2026-04-17.json'
    )
  })

  it('uses UTC date even when the timestamp is close to midnight local', () => {
    // 2026-04-17T23:59Z is still the 17th in UTC regardless of local tz.
    expect(formatExportFilename('2026-04-17T23:59:00.000Z')).toBe(
      'padelnachos-export-2026-04-17.json'
    )
  })
})

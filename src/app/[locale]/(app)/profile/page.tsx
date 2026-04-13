'use client'
// src/app/(app)/profile/page.tsx
// User profile — v3 brand styling with chunky clip-path shapes.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import Spinner from '../../../components/Spinner'
import BrandedLoader from '../../../components/BrandedLoader'
import CountryPicker from '@/components/CountryPicker'
import { useInvite } from '@/hooks/useInvite'
import { useBadges } from '@/hooks/useBadges'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BADGE_CATALOG, TIER_META, overallTierFromBadgeCount } from '@/lib/badges'
import { AmbassadorBadge } from '@/components/AmbassadorBadge'
import { withTimeout } from '@/lib/with-timeout'
import { useWakeRefresh } from '@/hooks/useWakeRefresh'

const V3 = {
  GREEN: '#7ED321',
  ORANGE: '#F5A623',
  LIVE_RED: '#FF4655',
  BG_BASE: '#1A1A1A',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
  clip: {
    badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
    button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  },
} as const

interface CountryOption {
  iso2: string
  name: string
}

interface BookmarkedMatch {
  id: string
  status: string
  round: string | null
  tournament_name: string | null
  pair1_player1_name: string | null
  pair1_player2_name: string | null
  pair2_player1_name: string | null
  pair2_player2_name: string | null
}

interface BookmarkedPlayer {
  id: string
  name: string
  avatar_url: string | null
}

export default function ProfilePage() {
  const { user, profile, loading: authLoading, retryKey, signOut } = useAuth()
  const router = useRouter()
  const { enabled, supported, permission, toggle: togglePush } = usePushNotifications()
  const { inviteCount, tier, loading: inviteLoading, shareNow } = useInvite()
  const { badges: earnedBadges, loading: badgesLoading } = useBadges()
  const [matches, setMatches] = useState<BookmarkedMatch[]>([])
  const [players, setPlayers] = useState<BookmarkedPlayer[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Country preference (broadcaster region override)
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
  const [savingCountry, setSavingCountry] = useState(false)
  const [countryDraft, setCountryDraft] = useState<string>('')  // '' = auto

  // Load distinct countries from broadcasters table for the picker
  useEffect(() => {
    let cancelled = false
    async function loadCountries() {
      const { data } = await supabase
        .from('broadcasters')
        .select('country_iso2, country_name')
        .eq('active', true)
      if (cancelled || !data) return
      const seen = new Map<string, string>()
      for (const row of data) {
        if (row.country_iso2 && !seen.has(row.country_iso2)) {
          seen.set(row.country_iso2, row.country_name ?? row.country_iso2.toUpperCase())
        }
      }
      const sorted = [...seen.entries()]
        .map(([iso2, name]) => ({ iso2, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setCountryOptions(sorted)
    }
    void loadCountries()
    return () => { cancelled = true }
  }, [])

  // Sync local draft when profile loads
  useEffect(() => {
    if (profile?.preferred_country !== undefined) {
      setCountryDraft(profile.preferred_country ?? '')
    }
  }, [profile?.preferred_country])

  const saveCountry = async (newValue: string) => {
    if (!user) return
    setSavingCountry(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ preferred_country: newValue || null })
        .eq('id', user.id)
      if (error) {
        console.warn('[Profile] saveCountry error:', error.message)
        return
      }
      setCountryDraft(newValue)
    } finally {
      setSavingCountry(false)
    }
  }

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/home')
  }, [authLoading, user, router])

  // Fetch bookmarked data — wraps queries in withTimeout so they fail fast
  // instead of spinning forever when the Supabase client is wedged.
  // Depends on retryKey so TOKEN_REFRESHED auto-triggers a refetch.
  const fetchBookmarks = useCallback(async () => {
    if (!user) return
    setLoadingData(true)

    try {
      const wrap = <T,>(p: PromiseLike<T>, label: string) => withTimeout(Promise.resolve(p), 10_000, label)

      const { data: matchBookmarks, error: matchErr } = await wrap(
        supabase.from('user_bookmarks').select('target_id').eq('user_id', user.id).eq('bookmark_type', 'match'),
        'profile:match-bookmarks'
      )
      if (matchErr) { setLoadingData(false); return }

      const { data: playerBookmarks } = await wrap(
        supabase.from('user_bookmarks').select('target_id').eq('user_id', user.id).eq('bookmark_type', 'player'),
        'profile:player-bookmarks'
      )

      const matchIds = (matchBookmarks ?? []).map((b: any) => b.target_id)
      if (matchIds.length > 0) {
        const { data: matchData } = await wrap(
          supabase.from('matches').select(`
            id, status, round,
            tournament:tournaments(name),
            pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name),
            pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name),
            pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name),
            pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name)
          `).in('id', matchIds).order('updated_at', { ascending: false }).limit(20),
          'profile:match-details'
        )
        setMatches((matchData ?? []).map((m: any) => ({
          id: m.id, status: m.status, round: m.round,
          tournament_name: m.tournament?.name ?? null,
          pair1_player1_name: m.pair1_player1?.display_name ?? m.pair1_player1?.name ?? null,
          pair1_player2_name: m.pair1_player2?.display_name ?? m.pair1_player2?.name ?? null,
          pair2_player1_name: m.pair2_player1?.display_name ?? m.pair2_player1?.name ?? null,
          pair2_player2_name: m.pair2_player2?.display_name ?? m.pair2_player2?.name ?? null,
        })))
      }

      const playerIds = (playerBookmarks ?? []).map((b: any) => b.target_id)
      if (playerIds.length > 0) {
        const { data: playerData } = await wrap(
          supabase.from('players').select('id, name, avatar_url').in('id', playerIds),
          'profile:player-details'
        )
        setPlayers(playerData ?? [])
      }
    } catch (e) {
      console.warn('[Profile] fetchBookmarks failed:', (e as Error)?.message)
    } finally {
      setLoadingData(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => { void fetchBookmarks() }, [fetchBookmarks, retryKey])

  // Recover from tab-idle Supabase auth lock deadlock
  useWakeRefresh(fetchBookmarks)

  if (authLoading || !user) return <BrandedLoader hints={['Loading your profile...', 'Almost ready...']} />

  const handleSignOut = async () => {
    await signOut()
    router.replace('/home')
  }

  const statusColor: Record<string, string> = {
    live: V3.LIVE_RED,
    scheduled: V3.MUTED,
    finished: '#9ca3af',
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 80, background: V3.BG_BASE, minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        height: 62,
      }}>
        <button
          onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: V3.MUTED,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
          Profile
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* User info */}
      <div style={{ padding: '24px 16px 16px', textAlign: 'center', borderBottom: `1px solid ${V3.BORDER}` }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          margin: '0 auto 12px', border: `3px solid ${V3.ORANGE}`,
          overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: `linear-gradient(135deg, ${V3.GREEN}, ${V3.ORANGE})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#000', fontSize: 24, fontWeight: 700,
            }}>
              {(profile?.display_name ?? 'U').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>
          {profile?.display_name ?? 'User'}
        </div>
        <div style={{ color: V3.MUTED, fontSize: 12, marginTop: 2 }}>
          {user.email}
        </div>
      </div>

      {/* Invite friends — share CTA with ambassador badge */}
      {user && (
        <div style={{ padding: '12px 16px 0' }}>
          <button
            onClick={() => { void shareNow() }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: 'rgba(255,255,255,0.03)',
              clipPath: V3.clip.card,
              padding: '12px 14px',
              border: 'none',
              marginBottom: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <div style={{ flexShrink: 0 }}>
              {tier ? (
                <AmbassadorBadge tier={tier} size="md" />
              ) : (
                <div style={{
                  width: 44, height: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1.5px solid rgba(255,255,255,0.1)`,
                  fontSize: 20,
                }}>🎾</div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                Invite friends
              </div>
              <div style={{ fontSize: 11, color: V3.MUTED, marginTop: 3 }}>
                {inviteLoading ? 'Loading…' : tier ? (
                  <>
                    <span style={{
                      display: 'inline-block',
                      fontSize: 9, fontWeight: 800,
                      color: tier.color,
                      background: tier.bgGradient,
                      padding: '1px 5px',
                      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                      marginRight: 5,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}>
                      {tier.name}
                    </span>
                    {inviteCount} {inviteCount === 1 ? 'friend' : 'friends'} on PadelNachos
                  </>
                ) : (
                  'Share the app with your friends'
                )}
              </div>
            </div>
            <span style={{ color: V3.MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
          </button>
        </div>
      )}

      {/* Achievements summary — links to /achievements */}
      {user && (
        <div style={{ padding: '0 16px' }}>
          <Link
            href="/achievements"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'rgba(255,255,255,0.03)',
              clipPath: V3.clip.card,
              padding: '12px 14px',
              marginBottom: 12,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            {/* Top 3 earned badge icons */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {(() => {
                const uniqueIds = [...new Set(earnedBadges.map(b => b.badge_id))]
                const topBadges = uniqueIds.slice(0, 3)
                const earnedMap = new Map<string, number>()
                for (const b of earnedBadges) {
                  const c = earnedMap.get(b.badge_id) ?? 0
                  if (b.tier > c) earnedMap.set(b.badge_id, b.tier)
                }
                return topBadges.map(id => {
                  const badge = BADGE_CATALOG.find(b => b.id === id)
                  if (!badge) return null
                  const badgeTier = (earnedMap.get(id) ?? 1) as 1 | 2 | 3 | 4
                  return (
                    <div key={id} style={{ marginRight: -4 }}>
                      <BadgeIcon svgIcon={badge.svgIcon} tier={badgeTier} size={32} />
                    </div>
                  )
                })
              })()}
              {earnedBadges.length === 0 && (
                <BadgeIcon svgIcon="lock" tier={null} size={32} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                Achievements
              </div>
              <div style={{ fontSize: 11, color: V3.MUTED, marginTop: 2 }}>
                {badgesLoading ? 'Loading\u2026' : (() => {
                  const count = new Set(earnedBadges.map(b => b.badge_id)).size
                  const total = BADGE_CATALOG.length
                  const badgeTier = overallTierFromBadgeCount(count)
                  const tierMeta = badgeTier ? TIER_META[badgeTier] : null
                  return tierMeta
                    ? <><span style={{
                        fontSize: 9, fontWeight: 800, color: tierMeta.color,
                        background: `${tierMeta.color}20`,
                        padding: '1px 5px', marginRight: 5,
                        clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                        textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>{tierMeta.label}</span>{count} of {total} badges</>
                    : `${count} of ${total} badges`
                })()}
              </div>
            </div>
            <span style={{ color: V3.MUTED, fontSize: 18, flexShrink: 0 }}>{'\u203A'}</span>
          </Link>
        </div>
      )}

      {/* Notification toggle */}
      <div style={{
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid rgba(255,255,255,0.04)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={V3.ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <div>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>Match Notifications</div>
            <div style={{ color: V3.MUTED, fontSize: 11 }}>
              {permission === 'denied'
                ? 'Notifications blocked in browser settings'
                : 'Get notified when bookmarked matches go live'}
            </div>
          </div>
        </div>
        <button
          onClick={togglePush}
          disabled={!supported || permission === 'denied'}
          style={{
            width: 44, height: 24, border: 'none', cursor: 'pointer',
            background: enabled ? V3.GREEN : 'rgba(255,255,255,0.15)',
            position: 'relative', transition: 'background 0.2s',
            opacity: !supported || permission === 'denied' ? 0.4 : 1,
            clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
          }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3,
            left: enabled ? 23 : 3,
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Region preference (overrides geo-IP for broadcaster lists) */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid rgba(255,255,255,0.04)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={V3.ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>Region</div>
            <div style={{ color: V3.MUTED, fontSize: 11 }}>
              Used to show local broadcasters and content. Defaults to your IP location.
            </div>
          </div>
        </div>
        <CountryPicker
          options={countryOptions}
          value={countryDraft}
          onChange={saveCountry}
          disabled={savingCountry || countryOptions.length === 0}
        />
      </div>

      {/* Bookmarked Matches */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{
          color: V3.ORANGE, fontSize: 11, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
        }}>
          Bookmarked Matches ({matches.length})
        </div>
        {loadingData ? (
          <Spinner />
        ) : matches.length === 0 ? (
          <div style={{ color: V3.MUTED, fontSize: 12, padding: '10px 0' }}>
            No bookmarked matches yet. Tap the bookmark icon on any match to save it here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map(m => (
              <Link
                key={m.id}
                href={`/match/${m.id}`}
                style={{
                  background: V3.BG_CARD, padding: '10px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textDecoration: 'none',
                  clipPath: V3.clip.card,
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontSize: 12, fontWeight: 500 }}>
                    {m.pair1_player1_name ?? '?'}/{m.pair1_player2_name ?? '?'} vs {m.pair2_player1_name ?? '?'}/{m.pair2_player2_name ?? '?'}
                  </div>
                  <div style={{ color: V3.MUTED, fontSize: 10 }}>
                    {m.tournament_name}{m.round ? ` - ${m.round}` : ''}
                  </div>
                </div>
                <div style={{
                  color: statusColor[m.status] ?? V3.MUTED,
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.05)',
                  padding: '2px 8px',
                  clipPath: V3.clip.badge,
                }}>
                  {m.status}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Bookmarked Players */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          color: V3.ORANGE, fontSize: 11, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
        }}>
          Bookmarked Players ({players.length})
        </div>
        {players.length === 0 ? (
          <div style={{ color: V3.MUTED, fontSize: 12, padding: '10px 0' }}>
            No bookmarked players yet.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {players.map(p => (
              <Link
                key={p.id}
                href={`/player/${p.id}`}
                style={{
                  background: V3.BG_CARD, padding: '10px 14px',
                  textAlign: 'center', textDecoration: 'none', minWidth: 80,
                  clipPath: V3.clip.card,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#374151', margin: '0 auto 6px', overflow: 'hidden',
                }}>
                  {p.avatar_url && (
                    <img src={p.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>
                <div style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>
                  {p.name.split(' ').pop()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Sign out */}
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${V3.BORDER}` }}>
        <button
          onClick={handleSignOut}
          style={{
            width: '100%', textAlign: 'center', color: V3.LIVE_RED, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', background: 'rgba(255,70,85,0.08)', border: 'none', padding: 12,
            fontFamily: 'inherit',
            clipPath: V3.clip.button,
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

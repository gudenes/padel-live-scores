'use client'
// Coaches tab of /rankings: rows mirror the player rows; the Overall/Men/Women filter lives in page.tsx.
// Reuses the /coaches data layer (fetchCoachesIndex) with the browser anon client.

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { RankBadge } from '@/components/RankBadge'
import { countryName, countryFlagUrl } from '@/lib/country-display'
import { fetchCoachesIndex, type CoachIndexRow, type CoachTab } from '@/lib/coach-page-data'
import { GREEN, GREEN_DIM, MUTED, BORDER, CHUNKY, MEN_BLUE, WOMEN_PURPLE } from '@/components/home/shared-constants'

const rankFor = (r: CoachIndexRow, tab: CoachTab) =>
  tab === 'men' ? r.rank_men : tab === 'women' ? r.rank_women : r.rank_overall
const pointsFor = (r: CoachIndexRow, tab: CoachTab) =>
  Number(tab === 'men' ? r.men_points : tab === 'women' ? r.women_points : r.total_points)

interface State { tab: CoachTab; rows: CoachIndexRow[]; page: number; hasMore: boolean; failed: boolean }

export default function CoachRankingList({ tab }: { tab: CoachTab }) {
  const t = useTranslations('coach')
  const tr = useTranslations('rankings')
  const [state, setState] = useState<State | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Filter changed (or retry): drop any in-flight load-more so the button never stays disabled.
    setLoadingMore(false)
    fetchCoachesIndex(supabase, tab, 1)
      .then(({ rows, hasMore }) => { if (!cancelled) setState({ tab, rows, page: 1, hasMore, failed: false }) })
      .catch((e) => {
        console.error('[rankings] coaches load error:', e)
        if (!cancelled) setState({ tab, rows: [], page: 1, hasMore: false, failed: true })
      })
    return () => { cancelled = true }
  }, [tab, reloadKey])

  const retry = () => { setState(null); setReloadKey((k) => k + 1) }

  const loadMore = useCallback(async () => {
    if (!state || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await fetchCoachesIndex(supabase, state.tab, state.page + 1)
      setState((s) => (s && s.tab === state.tab
        ? { ...s, rows: [...s.rows, ...next.rows], page: s.page + 1, hasMore: next.hasMore }
        : s))
    } catch (e) {
      console.error('[rankings] coaches load-more error:', e)
    } finally {
      // Only clear for the filter this request belongs to; a tab switch already reset it.
      setLoadingMore(false)
    }
  }, [state, loadingMore])

  const accent = tab === 'men' ? MEN_BLUE : tab === 'women' ? WOMEN_PURPLE : GREEN
  const loading = !state || state.tab !== tab
  const rows = loading ? [] : state.rows

  return (
    <div>
      {loading ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{
            width: 32, height: 32, margin: '0 auto 16px',
            border: `3px solid ${BORDER}`,
            borderTopColor: GREEN,
            borderRadius: '50%',
            animation: 'v3-rank-spin 0.8s linear infinite',
          }} />
          <div style={{ color: MUTED, fontSize: 13, fontWeight: 600 }}>{tr('loadingRankings')}</div>
          <style dangerouslySetInnerHTML={{ __html: `@keyframes v3-rank-spin { to { transform: rotate(360deg); } }` }} />
        </div>
      ) : state.failed ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: MUTED, fontSize: 13, fontWeight: 600 }}>
          <div>{t('indexError')}</div>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 14, background: GREEN_DIM, border: '1px solid rgba(126,211,33,0.25)', clipPath: CHUNKY.button,
              padding: '9px 24px', color: GREEN, fontWeight: 800, fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.04em', textTransform: 'uppercase',
            }}
          >
            {t('retry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: MUTED, fontSize: 13, fontWeight: 600 }}>
          {t('indexEmpty')}
        </div>
      ) : (
        rows.map((r, i) => {
          const rank = rankFor(r, tab) ?? i + 1
          const top3 = rank <= 3
          const flagUrl = countryFlagUrl(r.country)
          const topText = `${r.top.names.join(', ')}${r.top.more ? ` +${r.top.more}` : ''}`
          const idle = top3 ? 'rgba(245,166,35,0.04)' : 'transparent'
          return (
            <Link
              key={r.coach_id}
              href={`/coach/${r.slug}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', cursor: 'pointer',
                background: idle, borderBottom: `1px solid ${BORDER}`,
                transition: 'background 0.15s', textDecoration: 'none', color: 'inherit',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = GREEN_DIM)}
              onMouseLeave={(e) => (e.currentTarget.style.background = idle)}
            >
              <div style={{ width: 36, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                <RankBadge rank={rank} />
              </div>
              <Avatar src={r.avatar_url} alt={r.display_name} size={40}
                fallback={r.display_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                style={{ border: `2px solid ${accent}`, boxSizing: 'border-box', color: accent }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.display_name}
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  {flagUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={flagUrl} alt={r.country ?? ''} style={{ width: 16, height: 12, objectFit: 'cover', flexShrink: 0 }} />
                      <span style={{ flexShrink: 0 }}>{countryName(r.country)}</span>
                      {topText && <span style={{ flexShrink: 0 }}>·</span>}
                    </>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{topText}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(pointsFor(r, tab))}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{t('playersCount', { count: r.tab_player_count })}</div>
              </div>
            </Link>
          )
        })
      )}

      {!loading && state.hasMore && (
        <div style={{ padding: '20px 16px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: GREEN_DIM, border: '1px solid rgba(126,211,33,0.25)', clipPath: CHUNKY.button,
              padding: '11px 28px', color: GREEN, fontWeight: 800, fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.04em', textTransform: 'uppercase', opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {t('loadMore')}
          </button>
        </div>
      )}
    </div>
  )
}

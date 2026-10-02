'use client'
// Coaches tab of /rankings: Overall / Men / Women chips, 50 rows + "Show more".
// Reuses the /coaches data layer (fetchCoachesIndex) with the browser anon client.

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { CoachTopAvatars } from '@/components/CoachTopAvatars'
import { fetchCoachesIndex, initials, type CoachIndexRow, type CoachTab } from '@/lib/coach-page-data'
import { GREEN, GREEN_DIM, ORANGE, MUTED, BORDER, CHUNKY } from '@/components/home/shared-constants'

const TABS: CoachTab[] = ['overall', 'men', 'women']

const rankFor = (r: CoachIndexRow, tab: CoachTab) =>
  tab === 'men' ? r.rank_men : tab === 'women' ? r.rank_women : r.rank_overall
const pointsFor = (r: CoachIndexRow, tab: CoachTab) =>
  Number(tab === 'men' ? r.men_points : tab === 'women' ? r.women_points : r.total_points)

interface State { tab: CoachTab; rows: CoachIndexRow[]; page: number; hasMore: boolean; failed: boolean }

export default function CoachRankingList() {
  const t = useTranslations('coach')
  const tr = useTranslations('rankings')
  const locale = useLocale()
  const [tab, setTab] = useState<CoachTab>('overall')
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

  const labels: Record<CoachTab, string> = { overall: t('tabOverall'), men: t('tabMen'), women: t('tabWomen') }
  const loading = !state || state.tab !== tab
  const rows = loading ? [] : state.rows

  return (
    <div>
      <div role="tablist" style={{ display: 'flex', gap: 6, padding: '12px 16px 8px' }}>
        {TABS.map((tb) => {
          const active = tb === tab
          return (
            <button
              key={tb}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tb)}
              style={{
                padding: '6px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 800, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase',
                clipPath: CHUNKY.button,
                background: active ? GREEN : 'rgba(255,255,255,0.05)',
                color: active ? '#000' : MUTED,
              }}
            >
              {labels[tb]}
            </button>
          )
        })}
      </div>

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
          return (
            <Link
              key={r.coach_id}
              href={`/coach/${r.slug}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
                borderBottom: `1px solid ${BORDER}`, textDecoration: 'none', color: 'inherit',
              }}
            >
              <span style={{ width: 36, textAlign: 'right', fontSize: 13, fontWeight: 800, color: top3 ? ORANGE : MUTED }}>
                {rank}
              </span>
              <div aria-hidden="true" style={{
                width: 40, height: 40, borderRadius: '50%', background: top3 ? ORANGE : '#555', color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0,
              }}>
                {initials(r.display_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.display_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
                  <CoachTopAvatars players={r.top.players} />
                  <span style={{ fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.top.names.join(', ')}{r.top.more ? ` +${r.top.more}` : ''}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: GREEN }}>
                  {Math.round(pointsFor(r, tab)).toLocaleString(locale)}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>{t('playersCount', { count: r.tab_player_count })}</div>
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

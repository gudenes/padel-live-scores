'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useFollowing } from '@/hooks/useFollowing'
import { PickerCard, type PickerPlayer } from './PickerCard'
import { NotificationPromptSheet } from './NotificationPromptSheet'

const GREEN = '#7ED321'
const BG_BASE = '#1A1A1A'
const CHUNKY = {
  search: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export default function WelcomePickerPage() {
  const t = useTranslations('picker')
  const router = useRouter()
  const { toggle, getFollowed, loaded: followingLoaded } = useFollowing()

  const [players, setPlayers] = useState<PickerPlayer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [initialFollowed, setInitialFollowed] = useState<Set<string>>(new Set())
  const [showPushSheet, setShowPushSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [query, setQuery] = useState('')

  // Hydrate already-followed players if the user landed here with prior state
  useEffect(() => {
    if (followingLoaded) {
      const followed = new Set(getFollowed('player'))
      setPicked(followed)
      setInitialFollowed(followed)
    }
  }, [followingLoaded, getFollowed])

  // Fetch top 30 players
  useEffect(() => {
    let cancelled = false
    fetch('/api/picker/suggested-players')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PickerPlayer[]) => {
        if (!cancelled) setPlayers(data)
      })
      .catch(() => {
        if (!cancelled) setError(t('errorLoading'))
      })
    return () => { cancelled = true }
  }, [t])

  const togglePick = useCallback((id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const pickedCount = picked.size
  const canContinue = pickedCount >= 1

  // Country boost — applied server-side already; we just split by section
  // for the visual grouping. Read country from the cookie on the client.
  const userCountry = useMemo(() => {
    if (typeof document === 'undefined') return null
    const m = document.cookie.match(/(?:^|;\s*)geo-country=([^;]+)/)
    return m ? decodeURIComponent(m[1]).toUpperCase() : null
  }, [])

  // Live filter on top of the section split. When the user types, the grid
  // narrows to matches; the country split collapses if no matches exist.
  const { topInCountry, topRest, isFiltered } = useMemo(() => {
    if (!players) return { topInCountry: [], topRest: [], isFiltered: false }
    const q = normalize(query.trim())
    const matches = q
      ? players.filter(p => {
          const name = p.display_name || p.name || ''
          return normalize(name).includes(q)
        })
      : players
    if (!userCountry) {
      return { topInCountry: [], topRest: matches, isFiltered: q.length > 0 }
    }
    const inC: PickerPlayer[] = []
    const rest: PickerPlayer[] = []
    for (const p of matches) {
      if ((p.country ?? '').toUpperCase() === userCountry) inC.push(p)
      else rest.push(p)
    }
    return { topInCountry: inC, topRest: rest, isFiltered: q.length > 0 }
  }, [players, query, userCountry])

  const finishAndGoHome = useCallback(() => {
    try {
      localStorage.setItem('pn_picker_done', '1')
      localStorage.setItem('pn_picker_first_session', String(Date.now()))
    } catch {}
    router.replace('/home')
  }, [router])

  const handleContinue = useCallback(async () => {
    if (!canContinue || submitting) return
    setSubmitting(true)
    // Diff against the initial set so re-visits don't accidentally
    // toggle (and therefore UNFOLLOW) already-followed players.
    const toAdd: string[] = []
    const toRemove: string[] = []
    for (const id of picked) {
      if (!initialFollowed.has(id)) toAdd.push(id)
    }
    for (const id of initialFollowed) {
      if (!picked.has(id)) toRemove.push(id)
    }
    for (const id of toAdd) {
      await toggle('player', id, { silent: true })
    }
    for (const id of toRemove) {
      await toggle('player', id, { silent: true })
    }
    // Decide whether to show the push sheet
    let shouldShow = false
    try {
      const alreadyPrompted = localStorage.getItem('pn_push_prompted') === '1'
      const browserPermission = 'Notification' in window ? Notification.permission : 'denied'
      shouldShow = !alreadyPrompted && browserPermission === 'default'
    } catch {}

    if (shouldShow) {
      setShowPushSheet(true)
    } else {
      finishAndGoHome()
    }
  }, [canContinue, submitting, picked, initialFollowed, toggle, finishAndGoHome])

  const handleSkip = useCallback(() => {
    try { localStorage.setItem('pn_picker_done', '1') } catch {}
    router.replace('/home')
  }, [router])

  // Names of up to 3 picks for push-sheet body copy
  const pickedNames = useMemo(() => {
    if (!players) return []
    const map = new Map(players.map(p => [p.id, p.display_name || p.name]))
    return [...picked].slice(0, 3).map(id => map.get(id) ?? '').filter(Boolean)
  }, [picked, players])

  const noMatches = isFiltered && topInCountry.length === 0 && topRest.length === 0

  return (
    <div style={{
      background: BG_BASE,
      minHeight: '100dvh',
      maxWidth: 500,
      margin: '0 auto',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '24px 18px 18px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padelnachos-logo-v2.png"
          alt="PadelNachos"
          style={{ height: 56, objectFit: 'contain', margin: '0 auto 12px', display: 'block' }}
        />
        <h1 style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 8, letterSpacing: '-0.5px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.45 }}>
          {t('subtitle')}
        </p>
      </div>

      {/* Live search filter */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{
          width: '100%',
          padding: '0 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          clipPath: CHUNKY.search,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: 13,
              padding: '11px 0',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#888', fontSize: 16, padding: '4px 6px',
                fontFamily: 'inherit',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Body — grows so the CTA can stick to the bottom of the viewport */}
      <div style={{ padding: '18px 16px 0', flex: 1 }}>
        {error && (
          <div style={{ padding: 16, color: '#FF4655', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}
        {!players && !error && (
          <div style={{ padding: 32, color: '#666', fontSize: 12, textAlign: 'center' }}>…</div>
        )}
        {players && noMatches && (
          <div style={{ padding: 32, color: '#666', fontSize: 13, textAlign: 'center' }}>
            {t('errorLoading') /* reuse — generic "no results" tone */}
          </div>
        )}
        {players && !noMatches && (
          <>
            {topInCountry.length > 0 && (
              <>
                <h2 style={sectionStyle}>
                  {t('topInCountry', { country: userCountry ?? '' })}
                </h2>
                <Grid players={topInCountry} picked={picked} onToggle={togglePick} />
              </>
            )}
            {topRest.length > 0 && (
              <>
                <h2 style={sectionStyle}>{t('topWorldwide')}</h2>
                <Grid players={topRest} picked={picked} onToggle={togglePick} />
              </>
            )}
          </>
        )}
      </div>

      {/* Sticky CTA — sticky (not fixed) because .app-screen uses
          `contain: paint` which traps fixed-positioned descendants
          inside the scroll container. Sticky pins to the bottom of
          the viewport while scrolling within .app-screen. */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        marginTop: 24,
        background: 'linear-gradient(180deg, rgba(26,26,26,0), #1A1A1A 40%)',
        padding: '32px 16px 22px',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleSkip}
            style={{
              padding: '12px 18px', fontSize: 12, color: '#666',
              background: 'transparent', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            {t('skip')}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue || submitting}
            style={{
              flex: 1, padding: '14px 0',
              background: GREEN, color: '#000',
              fontSize: 13, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: 0.6,
              clipPath: CHUNKY.button,
              border: 'none', cursor: canContinue ? 'pointer' : 'not-allowed',
              opacity: canContinue ? 1 : 0.35,
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
          >
            {t('continue')}
            {pickedCount > 0 && (
              <span style={{
                background: 'rgba(0,0,0,0.2)',
                marginLeft: 8, padding: '1px 8px',
                clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
                fontSize: 11,
              }}>
                {pickedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {showPushSheet && (
        <NotificationPromptSheet
          pickedNames={pickedNames}
          onResolve={() => {
            setShowPushSheet(false)
            finishAndGoHome()
          }}
        />
      )}
    </div>
  )
}

const sectionStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900,
  textTransform: 'uppercase', letterSpacing: 0.8,
  color: '#888', margin: '18px 0 12px',
}

function Grid({
  players, picked, onToggle,
}: {
  players: PickerPlayer[]
  picked: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 10,
      marginBottom: 8,
    }}>
      {players.map(p => (
        <PickerCard
          key={p.id}
          player={p}
          picked={picked.has(p.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

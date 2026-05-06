'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useFollowing } from '@/hooks/useFollowing'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 1%, 99% 0%, 100% 99%, 1% 100%)'
const CHUNKY_BTN = 'polygon(2% 8%, 98% 0%, 100% 92%, 0% 100%)'

// Slow drift — easy to read, doesn't fight the user. Roughly one
// pill every ~6 seconds (PILL_WIDTH / SCROLL_PX_PER_SEC).
const SCROLL_PX_PER_SEC = 18
// After the user releases their finger, wait this long before resuming.
const RESUME_DELAY_MS = 2500

interface SuggestedPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  avatar_url: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function PlayerPill({
  p,
  followed,
  onToggle,
}: {
  p: SuggestedPlayer
  followed: boolean
  onToggle: (id: string) => void
}) {
  const t = useTranslations('suggestedPlayers')
  const display = p.display_name || p.name
  return (
    <div style={{
      flexShrink: 0,
      width: 116,
      background: 'rgba(255,255,255,0.03)',
      clipPath: CHUNKY_CARD,
      padding: '12px 10px 10px',
      textAlign: 'center',
      color: '#fff',
    }}>
      <Link
        href={`/player/${p.id}`}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{
          width: 68, height: 68,
          background: p.avatar_url ? `url(${p.avatar_url}) center top / cover` : 'linear-gradient(135deg, #2a2a2a, #1a1a1a)',
          border: `2px solid rgba(126,211,33,${followed ? 1 : 0.25})`,
          borderRadius: '50%',
          margin: '0 auto 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: GREEN,
        }}>
          {!p.avatar_url && initials(display)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2, height: 28, overflow: 'hidden', marginBottom: 4 }}>
          {display}
        </div>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 8 }}>
          {p.country ?? '—'} · <span style={{ color: GREEN, fontWeight: 800 }}>#{p.ranking ?? '—'}</span>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onToggle(p.id)}
        style={{
          width: '100%',
          background: followed ? 'rgba(126,211,33,0.15)' : GREEN,
          color: followed ? GREEN : '#000',
          border: followed ? `1px solid rgba(126,211,33,0.3)` : 'none',
          fontSize: 10, fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: 0.4,
          padding: '6px 0',
          clipPath: CHUNKY_BTN,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {followed ? t('followed') : t('follow')}
      </button>
    </div>
  )
}

export function SuggestedPlayersMarquee() {
  const t = useTranslations('suggestedPlayers')
  const [players, setPlayers] = useState<SuggestedPlayer[] | null>(null)
  const { isFollowing, toggle } = useFollowing()

  // Native horizontal scroll container — user can swipe / drag freely.
  // A rAF loop nudges scrollLeft while the user isn't interacting, giving
  // the slow auto-drift feel without freezing manual control.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const isInteractingRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/picker/suggested-players')
      .then(r => (r.ok ? r.json() : []))
      .then((data: SuggestedPlayer[]) => { if (!cancelled) setPlayers(data) })
      .catch(() => { if (!cancelled) setPlayers([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!players || players.length === 0) return
    const el = scrollerRef.current
    if (!el) return

    // Honor reduced-motion: stay still, user still has manual scroll.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let lastTs = 0

    function tick(ts: number) {
      if (!isInteractingRef.current && !reduceMotion) {
        if (lastTs > 0) {
          const dt = ts - lastTs
          el!.scrollLeft += (SCROLL_PX_PER_SEC * dt) / 1000
          // Seamless wrap: content is duplicated 2x, so reset to 0 once
          // we've drifted past the first half.
          const halfWidth = el!.scrollWidth / 2
          if (el!.scrollLeft >= halfWidth) el!.scrollLeft -= halfWidth
        }
        lastTs = ts
      } else {
        // Reset so resume doesn't compute a huge delta.
        lastTs = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    function pause() {
      isInteractingRef.current = true
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
    function scheduleResume() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        isInteractingRef.current = false
      }, RESUME_DELAY_MS)
    }

    el.addEventListener('mouseenter', pause)
    el.addEventListener('mouseleave', scheduleResume)
    el.addEventListener('pointerdown', pause)
    el.addEventListener('pointerup', scheduleResume)
    el.addEventListener('pointercancel', scheduleResume)
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('touchend', scheduleResume)
    el.addEventListener('touchcancel', scheduleResume)
    // Wheel / trackpad horizontal scroll also counts as user intent.
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('wheel', scheduleResume, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      el.removeEventListener('mouseenter', pause)
      el.removeEventListener('mouseleave', scheduleResume)
      el.removeEventListener('pointerdown', pause)
      el.removeEventListener('pointerup', scheduleResume)
      el.removeEventListener('pointercancel', scheduleResume)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('touchend', scheduleResume)
      el.removeEventListener('touchcancel', scheduleResume)
      el.removeEventListener('wheel', pause)
      el.removeEventListener('wheel', scheduleResume)
    }
  }, [players])

  if (!players || players.length === 0) return null

  // Duplicate the list 2x so the rAF wrap is seamless.
  const doubled = [...players, ...players]

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', margin: '0 0 10px',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: 0.8, color: '#fff',
        }}>
          {t('sectionTitle')}
        </div>
        <Link href="/rankings" style={{
          fontSize: 10, color: GREEN, fontWeight: 700, textDecoration: 'none',
        }}>
          {t('more')} →
        </Link>
      </div>

      <div
        ref={scrollerRef}
        className="pn-marquee-scroller"
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        }}
      >
        <div style={{
          display: 'flex',
          gap: 10,
          paddingLeft: 12,
          paddingRight: 12,
          width: 'max-content',
        }}>
          {doubled.map((p, idx) => (
            <PlayerPill
              key={`${p.id}-${idx}`}
              p={p}
              followed={isFollowing('player', p.id)}
              onToggle={(id) => toggle('player', id)}
            />
          ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .pn-marquee-scroller::-webkit-scrollbar { display: none; }
      `}} />
    </div>
  )
}

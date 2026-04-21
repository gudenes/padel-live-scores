// src/app/x/live-preview/ShadowLivePreview.tsx
// Client component: polls /api/padelgod-shadow/live-cards every 5s and
// renders a ShadowMatchCard per match with a collapsible PointLog.

'use client'

import { useEffect, useState, useRef } from 'react'
import ShadowMatchCard from '@/components/ShadowMatchCard'
import PointLog from '@/components/PointLog'
import { LIVE_CARDS_POLL_MS, type LiveCardsResponse } from '@/lib/padelgod-live-cards'

export default function ShadowLivePreview() {
  const [data, setData] = useState<LiveCardsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function tick() {
      try {
        const res = await fetch('/api/padelgod-shadow/live-cards?scope=live', {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as LiveCardsResponse
        if (!cancelled) {
          setData(body)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    }

    function startPolling() {
      tick()
      timerRef.current = window.setInterval(tick, LIVE_CARDS_POLL_MS)
    }
    function stopPolling() {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!timerRef.current) startPolling()
      } else {
        stopPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    startPolling()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stopPolling()
    }
  }, [])

  if (!data && !err) {
    return <div style={{ padding: 24, color: '#888' }}>Loading…</div>
  }

  const liveCards = data?.matches.filter(c => c.status === 'live') ?? []

  return (
    <div style={{ background: '#0A0A0A', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>
          Shadow Live Preview
        </h1>
        <div style={{ color: '#666', fontSize: 11, marginBottom: 16 }}>
          {err
            ? `Last fetch failed: ${err}`
            : `observedAt ${data?.observedAt ?? ''} · ${liveCards.length} live`}
        </div>
        {liveCards.length === 0 ? (
          <div style={{ color: '#888', padding: 24, textAlign: 'center' }}>
            No matches currently live in shadow mode.
          </div>
        ) : (
          liveCards.map(card => (
            <ShadowMatchCard
              key={card.id}
              card={card}
              observedAt={data?.observedAt ?? new Date().toISOString()}
            >
              <PointLog points={card.points} collapsible defaultOpen={false} />
            </ShadowMatchCard>
          ))
        )}
      </div>
    </div>
  )
}

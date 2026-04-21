// src/components/PointLog.tsx
// Plain monospace point-by-point log. Newest at the bottom. Auto-scrolls to
// the bottom when at bottom, otherwise respects the user's scroll position.

'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointEntry } from '@/lib/padelgod-live-cards'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function fmtLine(p: PointEntry): string {
  const srv = p.server === 1 ? 'Pair 1 serves' : p.server === 2 ? 'Pair 2 serves' : 'server unknown'
  const gp = p.isGoldenPoint ? '🥇 ' : ''
  return `[${fmtTime(p.at)}] S${p.set} G${p.game} P${p.pt} · ${srv} · ${gp}${p.score} → Pair ${p.winner} wins`
}

export default function PointLog({
  points,
  collapsible = false,
  defaultOpen = true,
}: {
  points: PointEntry[]
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const boxRef = useRef<HTMLPreElement | null>(null)
  const wasAtBottomRef = useRef(true)

  // Track whether the user is at the bottom BEFORE updates
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      wasAtBottomRef.current = distance < 8
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [open])

  // After new points arrive, if user was at bottom, scroll them back to bottom
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [points, open])

  if (collapsible && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#7ED321',
          fontSize: 11,
          cursor: 'pointer',
          padding: '4px 0',
          marginTop: 6,
        }}
      >
        Show point log ▸
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      {collapsible && (
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            fontSize: 11,
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          ▾ Hide point log
        </button>
      )}
      <pre
        ref={boxRef}
        style={{
          background: '#0A0A0A',
          border: '1px solid #222',
          borderRadius: 4,
          padding: 8,
          maxHeight: 200,
          overflow: 'auto',
          fontFamily: 'ui-monospace, SF Mono, Monaco, monospace',
          fontSize: 11,
          lineHeight: 1.5,
          color: '#ccc',
          margin: 0,
        }}
      >
        {points.length === 0 && (
          <span style={{ color: '#666' }}>No points yet.</span>
        )}
        {points.map((p, i) => {
          const isRecent = i >= points.length - 3
          return (
            <div
              key={`${p.set}-${p.game}-${p.pt}-${p.at}`}
              style={{ color: isRecent ? '#fff' : '#888' }}
            >
              {fmtLine(p)}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

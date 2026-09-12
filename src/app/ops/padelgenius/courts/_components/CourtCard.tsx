'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CourtConfig } from '@/lib/padelgenius/types'

export function CourtCard({ slug, config }: { slug: string; config: CourtConfig }) {
  const router = useRouter()
  const thumbUrl = `/padelgenius/courts/${slug}/thumb.png`

  const activate = async () => {
    await fetch(`/api/ops/padelgenius/courts/${slug}/activate`, { method: 'POST' })
    router.refresh()
  }
  const remove = async () => {
    if (!confirm(`Delete court "${config.name}"?`)) return
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}`, { method: 'DELETE' })
    if (!r.ok) alert((await r.json()).error)
    router.refresh()
  }

  return (
    <div style={{
      background: '#0e0e1a', borderRadius: 10, padding: 10,
      border: config.active ? '2px solid #22c55e' : '1px solid #2a2a3e',
      position: 'relative',
    }}>
      {config.active && <div style={{ position: 'absolute', top: -7, left: 10, background: '#22c55e', color: '#0a0a14', fontSize: 9, fontWeight: 900, padding: '1px 8px', borderRadius: 8, letterSpacing: 0.5 }}>ACTIVE</div>}
      <div style={{ width: '100%', aspectRatio: '2/3', background: `url("${thumbUrl}") center/cover #1976b8`, borderRadius: 6, marginBottom: 8 }} />
      <div style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>{config.name}</div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 8 }}>{config.imageUrl}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Link href={`/ops/padelgenius/courts/${slug}`} style={{ flex: 1, textAlign: 'center', background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#fde047', fontSize: 10, fontWeight: 700, textDecoration: 'none' }}>EDIT</Link>
        {!config.active && <button onClick={activate} style={{ flex: 1, background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#7dd3fc', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>SET ACTIVE</button>}
        {!config.active && (
          <button onClick={remove} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#ef4444', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
            <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
              <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

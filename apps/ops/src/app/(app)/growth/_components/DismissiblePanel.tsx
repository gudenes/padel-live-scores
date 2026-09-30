'use client'

// Panel with a dismiss (×) control. The choice is a per-browser convenience kept
// in localStorage; a slim "Show …" row lets the operator bring it back.

import { useSyncExternalStore, type ReactNode } from 'react'
import { Panel } from '@/components/ui'

const subs = new Set<() => void>()
const subscribe = (cb: () => void) => {
  subs.add(cb)
  window.addEventListener('storage', cb)
  return () => { subs.delete(cb); window.removeEventListener('storage', cb) }
}
const read = (key: string) => {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
const write = (key: string, hidden: boolean) => {
  try {
    if (hidden) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch { /* storage blocked: stays visible */ }
  subs.forEach(f => f())
}

const linkBtn = {
  background: 'none', border: 0, padding: 0, cursor: 'pointer',
  color: 'var(--text-3)', fontSize: 12, fontFamily: 'inherit',
} as const

export function DismissiblePanel({
  storageKey, title, restoreLabel, children,
}: { storageKey: string; title: string; restoreLabel: string; children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribe, () => read(storageKey), () => false)

  if (hidden) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
        <button type="button" style={linkBtn} onClick={() => write(storageKey, false)}>
          + {restoreLabel}
        </button>
      </div>
    )
  }
  return (
    <Panel
      title={title}
      actions={
        <button type="button" style={linkBtn} aria-label={`Hide ${title}`} title="Hide — you can bring it back" onClick={() => write(storageKey, true)}>
          ✕ Hide
        </button>
      }
    >
      {children}
    </Panel>
  )
}

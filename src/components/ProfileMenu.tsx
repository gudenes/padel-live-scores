'use client'

import { useEffect, useRef } from 'react'

const CHUNKY = {
  card: 'polygon(0% 3%, 97% 0%, 100% 97%, 3% 100%)',
}

interface ProfileMenuProps {
  open: boolean
  onClose: () => void
  /** Ref to the trigger button so we can ignore clicks on it (the button has its own toggle). */
  triggerRef: React.RefObject<HTMLElement | null>
}

export default function ProfileMenu({ open, onClose, triggerRef }: ProfileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside (ignore clicks on the trigger so it can toggle freely)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, onClose, triggerRef])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 256,
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset',
        clipPath: CHUNKY.card,
        overflow: 'hidden',
        zIndex: 200,
      }}
    >
      {/* Pointer */}
      <div style={{
        position: 'absolute',
        top: -7,
        right: 16,
        width: 12,
        height: 12,
        background: '#141414',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        transform: 'rotate(45deg)',
      }} />

      {/* Body slots — populated in subsequent tasks */}
      <div style={{ padding: 14, color: '#fff', fontSize: 12 }}>menu placeholder</div>
    </div>
  )
}

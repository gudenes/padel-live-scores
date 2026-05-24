// apps/ops/src/components/SidebarUserMenu.tsx
// Operator account chip at the bottom of the primary sidebar column.
// Avatar opens a popover with the operator's email + Sign out action.
// Click outside or press Escape to close. Sign-out posts to a server action.
'use client'

import { useEffect, useRef, useState } from 'react'
import { signOutAction } from '@/lib/actions/sign-out'

interface Props {
  userEmail: string | null
}

export function SidebarUserMenu({ userEmail }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!userEmail) return null

  const initial = userEmail.charAt(0).toUpperCase()

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 12,
        paddingBottom: 4,
        borderTop: '1px solid var(--border-subtle)',
        marginTop: 8,
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        title={`Signed in as ${userEmail}`}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--lime-bright) 0%, var(--lime-deep) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 700,
          fontSize: 14,
          border: 'none',
          cursor: 'pointer',
          boxShadow:
            '0 2px 6px rgba(132, 204, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.35)',
          transition: 'transform var(--dur-base) var(--ease-spring)',
          outline: open ? '2px solid var(--lime)' : 'none',
          outlineOffset: 2,
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.transform = 'scale(1.08)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = ''
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 6,
            left: 'calc(100% + 10px)',
            minWidth: 240,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: 6,
            boxShadow:
              '0 10px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)',
            zIndex: 50,
          }}
        >
          {/* Header — signed-in-as */}
          <div
            style={{
              padding: '10px 12px 12px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--status-neutral)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Signed in as
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--brand-primary-fg)',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {userEmail}
            </div>
          </div>

          {/* Sign out — server action */}
          <form action={signOutAction} style={{ marginTop: 4 }}>
            <button
              type="submit"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: 13,
                color: 'var(--brand-primary-fg)',
                cursor: 'pointer',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'background var(--dur-fast) var(--ease-out)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'
                e.currentTarget.style.color = 'var(--status-risk)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--brand-primary-fg)'
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

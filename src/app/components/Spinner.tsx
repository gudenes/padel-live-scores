'use client'
// src/app/components/Spinner.tsx
// Reusable loading spinner with optional label.
// Uses a pure-CSS animation — no external dependencies.

interface SpinnerProps {
  /** Diameter in px (default 28) */
  size?: number
  /** Optional text shown below the spinner */
  label?: string
  /** Fills the parent container vertically (default false) */
  fullHeight?: boolean
}

export default function Spinner({ size = 28, label, fullHeight = false }: SpinnerProps) {
  const id = 'spinner-anim'

  return (
    <>
      <style>{`
        @keyframes ${id} {
          0% { transform: rotate(0deg) }
          100% { transform: rotate(360deg) }
        }
      `}</style>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '40px 0',
        ...(fullHeight ? { minHeight: '60dvh' } : {}),
      }}>
        <div style={{
          width: size, height: size,
          border: `2.5px solid rgba(255,255,255,0.08)`,
          borderTopColor: 'var(--color-accent, #4a9eed)',
          borderRadius: '50%',
          animation: `${id} 0.8s linear infinite`,
        }} />
        {label && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {label}
          </div>
        )}
      </div>
    </>
  )
}

'use client'
// src/components/IconSlider.tsx
//
// Chunky-tilted toggle component for notification preferences (2026-05-27).
// Replaces the simple pill <Toggle> used in the old settings page.
//
// Usage:
//   <IconSlider checked={on} onChange={(next) => setOn(next)} ariaLabel="Push notifications" />
//
// Disabled state is for master-toggle-off OR row-currently-saving cases.

import styles from './IconSlider.module.css'

interface IconSliderProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel: string
}

export function IconSlider({ checked, onChange, disabled = false, ariaLabel }: IconSliderProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`${styles.track} ${checked ? styles.on : ''}`}
    >
      <span className={styles.thumb}>
        <svg className={styles.iconX} viewBox="0 0 24 24" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <svg className={styles.iconCheck} viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

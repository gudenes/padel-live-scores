'use client'
// src/components/SaveStateSlot.tsx
//
// Per-row save feedback indicator. Sits to the right of the IconSlider on
// the notifications Settings page. Three states:
//
//   idle    — empty (24x24 slot occupies space so layout doesn't shift)
//   saving  — green-ringed spinner (PATCH in flight)
//   saved   — check that holds 1.5s then fades out
//
// Caller drives state via the `state` prop. Failure case has no entry here;
// PR #459 error toast handles that path.

import { useEffect } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved'

interface SaveStateSlotProps {
  state: SaveState
  /** Called when the saved-flash finishes its hold and should return to idle. */
  onSavedFlashEnd?: () => void
}

export function SaveStateSlot({ state, onSavedFlashEnd }: SaveStateSlotProps) {
  // After the saved check is visible for 1.5s, ask the parent to flip back to idle.
  useEffect(() => {
    if (state !== 'saved' || !onSavedFlashEnd) return
    const t = setTimeout(onSavedFlashEnd, 1500)
    return () => clearTimeout(t)
  }, [state, onSavedFlashEnd])

  return (
    <span
      aria-live="polite"
      style={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {state === 'saving' && (
        <span
          style={{
            width: 14,
            height: 14,
            border: '2px solid rgba(126,211,33,0.25)',
            borderTopColor: '#7ED321',
            borderRadius: '50%',
            animation: 'pn-spin 800ms linear infinite',
          }}
        />
      )}
      {state === 'saved' && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-label="Saved"
          style={{ color: '#7ED321', animation: 'pn-flashout 1500ms ease-out forwards' }}
        >
          <polyline
            points="20 6 9 17 4 12"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

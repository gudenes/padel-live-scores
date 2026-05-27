'use client'
// src/components/NotificationNudgeProvider.tsx
//
// STUB — full implementation lands in Task 14. This stub exists so
// useNotificationNudge.ts can resolve the NotificationNudgeContext import
// at test-load time (vitest module resolution would otherwise fail before
// any test runs).
//
// Task 14 will replace this with the real provider that holds active-nudge
// state, fetches user prefs, and renders the NotificationNudgeSheet.

import { createContext, type ReactNode } from 'react'
import type { NudgeCategory } from '@/hooks/useNotificationNudge'

interface NotificationNudgeContextValue {
  publish: (category: NudgeCategory) => void
}

export const NotificationNudgeContext = createContext<NotificationNudgeContextValue>({
  publish: () => { /* no-op default — real publish in Task 14 */ },
})

// Stub provider — just passes children through. Task 14 wires the real
// state machine + sheet rendering. Mounting this stub in the app layout
// in Task 16 is harmless; bookmark/follow triggerNudge() calls will fall
// through to the no-op publish until Task 14 ships.
export function NotificationNudgeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

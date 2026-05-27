'use client'
// src/components/NotificationNudgeSheet.tsx
//
// STUB — full implementation lands in Task 15. This stub exists so
// NotificationNudgeProvider.tsx can resolve the import at test-load time
// (vitest module resolution would otherwise fail before any test runs).
//
// Task 15 will replace this with the real bottom-sheet UI.

import type { NudgeCategory, NudgeState } from '@/hooks/useNotificationNudge'

interface Props {
  state: NudgeState
  category: NudgeCategory
  onDismiss: () => void
  onTurnOn: () => void
}

// Stub sheet — renders nothing. Task 15 wires the real UI.
export function NotificationNudgeSheet(_props: Props) {
  return null
}

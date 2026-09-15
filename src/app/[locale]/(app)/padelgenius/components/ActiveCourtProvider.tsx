// src/app/[locale]/(app)/padelgenius/components/ActiveCourtProvider.tsx
'use client'
import { createContext, useContext } from 'react'
import type { CourtConfig } from '@/lib/padelgenius/types'

const Ctx = createContext<CourtConfig | null>(null)

export function ActiveCourtProvider({ court, children }: { court: CourtConfig; children: React.ReactNode }) {
  return <Ctx.Provider value={court}>{children}</Ctx.Provider>
}

export function useActiveCourt(): CourtConfig {
  const c = useContext(Ctx)
  if (!c) throw new Error('useActiveCourt must be used inside ActiveCourtProvider')
  return c
}

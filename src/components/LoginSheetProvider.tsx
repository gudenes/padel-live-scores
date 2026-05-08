'use client'
// src/components/LoginSheetProvider.tsx
// App-root provider exposing a global openLoginSheet() so any component
// can trigger the sign-in sheet without owning its own local state.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'

const LoginSheet = dynamic(() => import('@/components/LoginSheet'), { ssr: false })

interface LoginSheetContextValue {
  openLoginSheet: () => void
  closeLoginSheet: () => void
  isOpen: boolean
}

const LoginSheetContext = createContext<LoginSheetContextValue>({
  openLoginSheet: () => {},
  closeLoginSheet: () => {},
  isOpen: false,
})

export function useLoginSheet() {
  return useContext(LoginSheetContext)
}

export function LoginSheetProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)

  const openLoginSheet = useCallback(() => setOpen(true), [])
  const closeLoginSheet = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('pn:login-open', onOpen)
    return () => window.removeEventListener('pn:login-open', onOpen)
  }, [])

  const value = useMemo(
    () => ({ openLoginSheet, closeLoginSheet, isOpen }),
    [openLoginSheet, closeLoginSheet, isOpen],
  )

  return (
    <LoginSheetContext.Provider value={value}>
      {children}
      <LoginSheet open={isOpen} onClose={closeLoginSheet} />
    </LoginSheetContext.Provider>
  )
}

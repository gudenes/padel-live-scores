'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Brand = 'nachos' | 'labs'
const KEY = 'padel.brand'
export const BRANDS: Record<Brand, { wordmark: string; accentWord: string; host: string; markGlyph: 'paddle' | 'L' }> = {
  nachos: { wordmark: 'PADEL', accentWord: 'NACHOS', host: 'padelnachos.com', markGlyph: 'paddle' },
  labs:   { wordmark: 'PADEL', accentWord: 'LABS',   host: 'padellabs.tech',  markGlyph: 'L' },
}
const Ctx = createContext<{ brand: Brand; setBrand: (b: Brand) => void }>({ brand: 'nachos', setBrand: () => {} })
export const useBrand = () => useContext(Ctx)

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrandState] = useState<Brand>('nachos')
  useEffect(() => {
    let stored: Brand | null = null
    try { stored = localStorage.getItem(KEY) as Brand | null } catch {}
    if (stored === 'nachos' || stored === 'labs') setBrandState(stored)
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-brand', brand)
    try { localStorage.setItem(KEY, brand) } catch {}
  }, [brand])
  const setBrand = useCallback((b: Brand) => setBrandState(b), [])
  return <Ctx.Provider value={{ brand, setBrand }}>{children}</Ctx.Provider>
}

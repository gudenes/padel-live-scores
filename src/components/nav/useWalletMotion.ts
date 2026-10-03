'use client'
import { useEffect, useState } from 'react'
import { rememberWalletBalance } from '@/lib/wallet-motion'

type Transition = { key: string; from: number; to: number }
export function useWalletMotion(walletKey: string | undefined, balance: number | null) {
  const [transition, setTransition] = useState<Transition | null>(null)
  const [frame, setFrame] = useState<{ transition: Transition; value: number; running: boolean } | null>(null)
  useEffect(() => {
    if (!walletKey || balance === null || !Number.isFinite(balance)) return
    const remember = () => {
      if (document.hidden) return
      try {
        const from = rememberWalletBalance(window.localStorage, walletKey, balance)
        if (from !== null) setTransition({ key: walletKey, from, to: balance })
      } catch { /* localStorage can be unavailable in private webviews. */ }
    }
    remember()
    document.addEventListener('visibilitychange', remember)
    return () => document.removeEventListener('visibilitychange', remember)
  }, [walletKey, balance])
  useEffect(() => {
    if (!transition) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    const finish = () => { cancelAnimationFrame(raf); setFrame({ transition, value: transition.to, running: false }) }
    if (preference.matches) { finish(); return }
    const duration = transition.to > transition.from ? 1300 : 650
    const start = performance.now()
    setFrame({ transition, value: transition.from, running: true })
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      setFrame({ transition, value: transition.from + (transition.to - transition.from) * (1 - (1 - progress) ** 3), running: progress < 1 })
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    const hide = () => { if (document.hidden) finish() }
    raf = requestAnimationFrame(tick)
    preference.addEventListener('change', finish)
    document.addEventListener('visibilitychange', hide)
    return () => { cancelAnimationFrame(raf); preference.removeEventListener('change', finish); document.removeEventListener('visibilitychange', hide) }
  }, [transition])
  const current = frame && frame.transition.key === walletKey && frame.transition.to === balance ? frame : null
  return { amount: current?.value ?? balance, direction: current?.running ? (current.transition.to > current.transition.from ? 'gain' : 'decrease') : null }
}

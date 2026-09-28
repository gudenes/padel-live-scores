'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import ProfileButton from '@/components/ProfileButton'
import { useRouter, usePathname } from '@/i18n/navigation'
import PlayerWallet from './PlayerWallet'

type Wallet = { userId: string; allowed: boolean; balance: number | null }

export default function HeaderAccount() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const userId = user?.id
  useEffect(() => {
    if (!userId || loading) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const response = await fetch('/api/play/wallet', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Wallet unavailable')
        const data = await response.json()
        if (!controller.signal.aborted) setWallet({ userId, allowed: data.allowed === true,
          balance: typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : null })
      } catch {
        if (!controller.signal.aborted) setWallet(null)
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [userId, loading, pathname])
  // Account-bound state prevents a previous user's wallet flashing after sign-out.
  if (loading || !userId || wallet?.userId !== userId || !wallet.allowed) return <ProfileButton />
  return <PlayerWallet balance={wallet.balance} onPositions={() => router.push('/play?view=mine')} />
}

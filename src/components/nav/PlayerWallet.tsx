'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import ProfileButton from '@/components/ProfileButton'
import GuacaCoin from '@/components/GuacaCoin'

import styles from './PlayerWallet.module.css'

export default function PlayerWallet({ balance, onPositions }: { balance: number | null; onPositions: () => void }) {
  const locale = useLocale()
  const t = useTranslations('playerProfile')
  const play = useTranslations('play')
  const router = useRouter()
  const amount = balance === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(balance)
  const compact = balance === null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(balance)
  return <div className={styles.wallet}>
    <button className={styles.balance} onClick={onPositions} aria-label={`${t('available')}: ${amount}. ${play('subnav.myPositions')}`} title={`${t('available')}: ${amount}`}>
      <span className={styles.coin} aria-hidden="true"><GuacaCoin size={20} /></span>
      <span key={amount} className={styles.amount}>{compact}</span>
    </button>
    <div className={styles.avatar}>
      <ProfileButton size={46} onProfileClick={() => router.push('/profile')} label={play('leaders.myProfile')} />
    </div>
  </div>
}

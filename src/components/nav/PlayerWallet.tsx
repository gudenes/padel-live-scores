'use client'

import { useLocale, useTranslations } from 'next-intl'
import ProfileButton from '@/components/ProfileButton'
import GuacaCoin from '@/components/GuacaCoin'

import { useWalletMotion } from './useWalletMotion'

import styles from './PlayerWallet.module.css'

export default function PlayerWallet({ balance, walletKey, onPositions }: { balance: number | null; walletKey?: string; onPositions: () => void }) {
  const locale = useLocale()
  const t = useTranslations('playerProfile')
  const play = useTranslations('play')
  const motion = useWalletMotion(walletKey, balance)
  const amount = balance === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(balance)
  const compact = motion.amount === null ? '—' : motion.direction
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(motion.amount)
    : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(motion.amount)
  return <div className={styles.wallet}>
    <button className={styles.balance} onClick={onPositions} aria-label={`${t('available')}: ${amount}. ${play('subnav.myPositions')}`} title={`${t('available')}: ${amount}`}>
      <span className={styles.coin} aria-hidden="true"><GuacaCoin size={20} /></span>
      <span className={styles.amount} aria-hidden="true">{compact}</span>
      {motion.direction && <span key={`${walletKey}:${balance}`} className={styles.trail} data-direction={motion.direction} aria-hidden="true">
        {Array.from({ length: motion.direction === 'gain' ? 5 : 3 }, (_, i) => <span key={i} className={styles.flying} style={{ animationDelay: `${i * 100}ms` }}><GuacaCoin size={22} /></span>)}
      </span>}
    </button>
    <div className={styles.avatar}>
      <ProfileButton size={46} label={play('leaders.myProfile')} />
    </div>
  </div>
}

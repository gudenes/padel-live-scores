'use client'

import { useEffect, useRef } from 'react'
import { useLocale } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { Link, usePathname } from '@/i18n/navigation'
import { useConsent } from '@/hooks/useConsent'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import { betaLocale } from '@/lib/beta-copy'
import { BETA_SIGNUPS_CLOSE_AT, betaSignupsClosed } from '@/lib/beta-schedule'
import { hasSeenBetaInvitation, markBetaInvitationSeen } from '@/lib/beta-invitation'
import styles from './BetaInvitation.module.css'

const messages = {
  en: { label: 'CLOSED BETA · OCTOBER 10', title: 'Know padel? Play your predictions.', body: 'Be among the first to try Padel Predict. Virtual currency, no real-money betting.', commitment: '3 weeks of play + a 15-minute feedback interview.', reward: 'Exclusive beta badge + 1 year of Pro, with eligibility to win real prizes.', join: 'Join the beta', dismiss: 'Not now', close: 'Close beta invitation' },
  es: { label: 'BETA CERRADA · 10 DE OCTUBRE', title: '¿Sabes de pádel? Ponlo en juego.', body: 'Sé de los primeros en probar Padel Predict. Moneda virtual, sin apuestas con dinero real.', commitment: '3 semanas de juego + una entrevista de 15 minutos.', reward: 'Insignia exclusiva + 1 año de Pro para optar a premios reales.', join: 'Quiero participar', dismiss: 'Ahora no', close: 'Cerrar invitación a la beta' },
  pt: { label: 'BETA FECHADO · 10 DE OUTUBRO', title: 'Entende de padel? Entre no jogo.', body: 'Seja um dos primeiros a experimentar o Padel Predict. Moeda virtual, sem apostas com dinheiro real.', commitment: '3 semanas de jogo + uma entrevista de 15 minutos.', reward: 'Emblema exclusivo + 1 ano de Pro para concorrer a prêmios reais.', join: 'Quero participar', dismiss: 'Agora não', close: 'Fechar convite para o beta' },
}

export function BetaInvitation() {
  const locale = betaLocale(useLocale())
  const t = messages[locale]
  const pathname = usePathname()
  const { hasDecided } = useConsent()
  const { isOpen: loginOpen } = useLoginSheet()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    // Keep signup, onboarding and legal/support flows interruption-free.
    const excluded = /^\/(beta|welcome|privacy|terms|support|delete-account)(\/|$)/.test(pathname)
    const dialog = dialogRef.current
    if (!dialog || excluded || loginOpen || betaSignupsClosed()) return
    if (!hasDecided && !Capacitor.isNativePlatform()) return
    if (hasSeenBetaInvitation()) return

    const poll = window.setInterval(() => {
      if (betaSignupsClosed() || hasSeenBetaInvitation()) {
        window.clearInterval(poll)
        return
      }
      if (document.visibilityState !== 'visible') return
      // Wait for any existing modal, including login and install prompts.
      const others = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      if (others) return
      if (typeof dialog.showModal !== 'function') { window.clearInterval(poll); return }
      dialog.showModal() // Native focus trap, Escape dismissal and background inertness.
      markBetaInvitationSeen() // Count an actual impression, not a page load.
      window.clearInterval(poll)
    }, 2000)
    const expiry = window.setTimeout(() => dialog.close(), Math.max(0, Date.parse(BETA_SIGNUPS_CLOSE_AT) - Date.now()))
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(expiry)
      if (dialog.open) dialog.close()
    }
  }, [pathname, hasDecided, loginOpen])

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="beta-invite-title" aria-describedby="beta-invite-description">
      <button type="button" className={styles.close} aria-label={t.close} onClick={() => dialogRef.current?.close()}>×</button>
      <p className={styles.label}>{t.label}</p>
      <div className={styles.symbol} aria-hidden="true">↗</div>
      <h2 id="beta-invite-title">{t.title}</h2>
      <p id="beta-invite-description" className={styles.body}>{t.body}</p>
      <p className={styles.commitment}>{t.commitment}</p>
      <p className={styles.reward}>{t.reward}</p>
      <Link href="/beta" locale={locale} className={styles.join} onClick={() => dialogRef.current?.close()}>{t.join}<span aria-hidden="true">→</span></Link>
      <button type="button" className={styles.dismiss} onClick={() => dialogRef.current?.close()}>{t.dismiss}</button>
    </dialog>
  )
}

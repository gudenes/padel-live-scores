'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { usePathname } from '@/i18n/navigation'
import { useConsent } from '@/hooks/useConsent'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import ReleasePopup from './ReleasePopup'
import { hasSeenRelease, markReleaseSeen, releaseEligible } from './release-state'

export default function ProductRelease() {
  const locale = useLocale()
  const pathname = usePathname()
  const { hasDecided } = useConsent()
  const { isOpen: loginOpen } = useLoginSheet()
  const [open, setOpen] = useState(false)
  const eligible = releaseEligible(pathname) && !loginOpen && (hasDecided || Capacitor.isNativePlatform())

  useEffect(() => {
    if (!eligible || hasSeenRelease()) return
    const timer = window.setInterval(() => {
      if (hasSeenRelease() || !releaseEligible(pathname)) {
        window.clearInterval(timer)
        return
      }
      if (document.visibilityState !== 'visible') return
      const otherDialogs = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')
      if (Array.from(otherDialogs).some(element => !element.closest('[aria-hidden="true"], [hidden]'))) return
      setOpen(true)
      window.clearInterval(timer)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [eligible, pathname])

  if (!eligible || !open) return null
  return <ReleasePopup open={open} locale={locale} onShown={markReleaseSeen} onClose={() => setOpen(false)} />
}

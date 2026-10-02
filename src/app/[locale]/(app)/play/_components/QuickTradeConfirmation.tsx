'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatGuacas } from './shared'
import type { ConfirmedTrade } from './ConfirmScreen'

export default function QuickTradeConfirmation({ trade, onDone }: { trade: ConfirmedTrade; onDone: () => void }) {
  const t = useTranslations('play')
  const locale = useLocale()
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    setClosing(false)
    const exit = window.setTimeout(() => setClosing(true), 2800)
    const timer = window.setTimeout(onDone, 3100)
    return () => { window.clearTimeout(exit); window.clearTimeout(timer) }
  }, [onDone, trade])
  return <div className={`pl-quick-confirm${closing ? ' pl-toast-closing' : ''}`} role="status" aria-live="polite">
    <span className="pl-quick-check" aria-hidden="true">✓</span>
    <h2>{t('done.title')}</h2>
    <p className="pl-toast-question">{trade.question}</p>
    <p>{t(`deck.${trade.side}`)} · {formatGuacas(trade.cost, locale)} G</p>
  </div>
}

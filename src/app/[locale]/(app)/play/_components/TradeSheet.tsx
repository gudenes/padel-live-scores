'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Press, formatGuacas } from './shared'
import { previewBuy } from './market-preview'
import type { PlayMarket, Side } from './types'

export interface TradeSheetProps {
  market: PlayMarket
  side: Side
  initialStake: number
  balance: number
  submitting: boolean
  error: string | null
  onConfirm: (guacas: number, side: Side) => void
  onClose: () => void
}

export default function TradeSheet({ market, side, initialStake, balance, submitting, error, onConfirm, onClose }: TradeSheetProps) {
  const t = useTranslations('play')
  const locale = useLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const [chosenSide, setChosenSide] = useState(side)
  const [amount, setAmount] = useState(String(initialStake))
  const stake = Number(amount)
  const quote = previewBuy(market, chosenSide, stake)
  const affordable = stake <= balance
  const [now, setNow] = useState(() => Date.now())
  const locked = !!market.locksAt && new Date(market.locksAt).getTime() <= now
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    element?.showModal()
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); element?.close(); previous?.focus() }
  }, [])
  const money = (value: number) => `${formatGuacas(value, locale)} G`
  const message = error || (locked ? t('trade.locked') : !affordable ? t('trade.insufficient') : !quote ? t('explore.validAmount') : null)
  return <dialog ref={dialog} className="pl-trade-dialog" aria-labelledby="pl-trade-title" onCancel={e => { e.preventDefault(); if (!submitting) onClose() }}>
    <div className="pl-trade-content">
      <div className="pl-sheet-head"><h2 id="pl-trade-title">{t('explore.prediction')}</h2><button type="button" className="pl-x" disabled={submitting} onClick={onClose} aria-label={t('trade.close')}>×</button></div>
      <div className="pl-market-context">{market.context}</div>
      <h3 className="pl-trade-question">{market.question}</h3>
      <div className="pl-choice-toggle" aria-label={t('explore.outcome')}>
        {(['yes','no'] as const).map(option => <button type="button" key={option} className={`pl-${option}`} aria-pressed={chosenSide === option} disabled={submitting} onClick={() => setChosenSide(option)}>{t(`deck.${option}`)}</button>)}
      </div>
      <label className="pl-stake-label" htmlFor="pl-stake">{t('explore.amount')}</label>
      <div className="pl-stake-input"><input id="pl-stake" type="number" inputMode="numeric" min="1" step="1" max={balance} value={amount} disabled={submitting} onChange={e => setAmount(e.target.value)} aria-describedby="pl-amount-help" /><span className="pl-coin">G</span></div>
      <p className="pl-available" id="pl-amount-help">{t('explore.available')} <b>{money(balance)}</b></p>
      <div className="pl-amounts">{[100,250,500,1000].map(value => <button key={value} type="button" className={`pl-amt${stake === value ? ' pl-on' : ''}`} disabled={submitting || value > balance} onClick={() => setAmount(String(value))}>{money(value)}</button>)}</div>
      <div className="pl-return-summary" aria-live="polite">
        <span>{t('explore.ifWin')}</span><strong>{quote ? `≈${money(quote.payout)}` : '—'}</strong>
        <p>{quote ? t('explore.gain', { stake: money(quote.cost), gain: money(quote.payout - quote.cost) }) : t('explore.validAmount')}</p>
      </div>
      <div className="pl-loss-summary"><span>{t('explore.ifLose')}</span><b>{quote ? money(quote.cost) : '—'}</b></div>
      <div className="pl-after"><span>{t('explore.balanceAfter')}</span><b>{quote && affordable ? money(balance - quote.cost) : '—'}</b></div>
      <p className="pl-helper">{t('explore.estimate')}</p>
      {market.locksAt && <p className="pl-helper">{t('explore.closes', { date: new Intl.DateTimeFormat(locale, { dateStyle:'medium', timeStyle:'short' }).format(new Date(market.locksAt)) })}</p>}
      {message && <p className="pl-trade-error" role="alert">{message}</p>}
      <Press size="size-lg" block disabled={submitting || !quote || !affordable || locked} onClick={() => onConfirm(stake, chosenSide)}>{submitting ? t('trade.submitting') : `${t('trade.confirm')} · ${quote ? money(quote.cost) : '—'}`}</Press>
    </div>
  </dialog>
}

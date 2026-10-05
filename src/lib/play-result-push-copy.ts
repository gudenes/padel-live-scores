export interface PushResult {
 id: number
 market_id: string
 revision: number
 outcome: 'yes' | 'no' | 'void'
 delta: number
 corrected: boolean
 created_at: string
}
export interface PushPosition {
 market_id: string
 yes_shares: number
 no_shares: number
 markets: { match_id: string; status: string; settlement_revision: number }
}

/** Only confirmed, current revisions. Never infer a win from a wallet change. */
export function currentPushResults(notices: PushResult[], positions: PushPosition[], sent: number[]) {
 return notices.filter(n => !sent.includes(n.id) && positions.some(p =>
  p.market_id === n.market_id && p.markets.settlement_revision === n.revision &&
  ['settled', 'void'].includes(p.markets.status)))
}

export function playPushSummary(results: PushResult[], positions: PushPosition[]): string {
 if (!results.length) return ''
 const corrected = results.filter(n => n.corrected)
 const initial = results.filter(n => !n.corrected)
 const received = initial.reduce((sum, n) => sum + n.delta, 0)
 const refunds = initial.filter(n => n.outcome === 'void').length
 const predictions = initial.filter(n => n.outcome !== 'void')
 const bothSides = predictions.some(n => positions.some(p => p.market_id === n.market_id && p.yes_shares > 0 && p.no_shares > 0))
 const correct = predictions.filter(n => positions.some(p => p.market_id === n.market_id &&
  (n.outcome === 'yes' ? p.yes_shares > 0 : p.no_shares > 0))).length
 const parts: string[] = []
 if (predictions.length) parts.push(bothSides || correct === 0 ? 'Your prediction results are ready.'
  : predictions.length === 1 ? 'Your prediction was correct!'
  : `${correct} of your ${predictions.length} predictions were correct.`)
 if (refunds) parts.push(`${refunds === 1 ? 'Your prediction was' : `${refunds} predictions were`} refunded.`)
 if (received > 0) parts.push(`${received.toLocaleString('en-US')} Guacas added to your balance.`)
 if (corrected.length) {
  const delta = corrected.reduce((sum, n) => sum + n.delta, 0)
  parts.push(`Result corrected · balance adjustment: ${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')} Guacas.`)
 }
 return parts.join(' ')
}

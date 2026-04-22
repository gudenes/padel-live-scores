'use client'
// Winner banner shown at the top of a finished match page.
import { Link } from '@/i18n/navigation'
import { Match } from '@/types/match'
import { GREEN, GREEN_DIM, CHUNKY } from './lib/constants'

export function WinnerBanner({ match, winnerPair, pair1Label, pair2Label, nextMatchId }: { match: Match; winnerPair: number; pair1Label: string; pair2Label: string; nextMatchId: string | null }) {
  const winnerLabel = winnerPair === 1 ? pair1Label : pair2Label
  const round = (match.round ?? '').toLowerCase()
  const isFinal = round.includes('final') && !round.includes('semifinal') && !round.includes('quarter')
  const advancement = round.includes('semifinal') ? { badge: 'Finals', text: 'Advances to the Finals' }
    : round.includes('quarter') ? { badge: 'Semifinals', text: 'Advances to the Semifinals' }
    : isFinal ? { badge: 'Champion', text: 'Tournament Champion!' }
    : null
  return (
    <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, rgba(126,211,33,0.04), rgba(126,211,33,0.01))', borderBottom: `0.5px solid rgba(126,211,33,0.2)`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% -20%, rgba(126,211,33,0.09) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: GREEN_DIM, clipPath: CHUNKY.badge, flexShrink: 0 }}>
          <span style={{ fontSize: 16, color: GREEN, fontWeight: 900 }}>W</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.6)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 3 }}>Winner</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: GREEN, lineHeight: 1.2 }}>{winnerLabel}</div>
        </div>
        {advancement && (
          <div style={{ background: GREEN_DIM, border: `0.5px solid rgba(126,211,33,0.25)`, clipPath: CHUNKY.badge, padding: '4px 10px', flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: GREEN }}>{advancement.badge}</span>
          </div>
        )}
      </div>
      {!isFinal && nextMatchId && (
        <Link href={`/match/${nextMatchId}`} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 42, marginTop: 8, textDecoration: 'none' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN }}>{advancement ? advancement.text : 'Next match'}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      )}
      {isFinal && advancement && (
        <div style={{ fontSize: 10, color: 'rgba(126,211,33,0.4)', paddingLeft: 42, marginTop: 6 }}>{advancement.text}</div>
      )}
    </div>
  )
}

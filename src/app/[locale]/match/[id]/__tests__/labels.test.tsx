// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { WinnerBanner } from '../WinnerBanner'
import { PlayerCard } from '../PlayerCard'
import type { Match } from '@/types/match'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import it_ from '@/messages/it.json'
import pt from '@/messages/pt.json'
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>, useRouter: () => ({ push: vi.fn() }) }))
for (const [locale, messages] of Object.entries({ en, es, fr, it: it_, pt })) {
  describe(locale, () => {
    function render(element: React.ReactNode) {
      const errors: unknown[] = []
      const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" onError={e => errors.push(e)}>{element}</NextIntlClientProvider>)
      expect(errors).toEqual([])
      expect(html).not.toMatch(/competitionLabels\.|matchDetail\.|prediction\./)
      return html
    }
    it('renders final and semifinal winners using normalized rounds', () => {
      const props = { winnerPair: 1, pair1Label: 'One / Two', pair2Label: 'Three / Four', nextMatchId: 'next' }
      const final = render(<WinnerBanner {...props} match={{ round: 'F' } as Match} />)
      expect(final).toContain(messages.competitionLabels.championMessage)
      const semi = render(<WinnerBanner {...props} match={{ round: 'semi-finals' } as Match} />)
      expect(semi).toContain(messages.competitionLabels.advanceFinal)
      expect(semi).not.toContain(messages.competitionLabels.championMessage)
    })
    it('renders player side and ranking with season stats', () => {
      const html = render(<PlayerCard player={{ id: 'player', name: 'Test Player', ranking: 5, side: 'backhand' }} seasonStats={{ winRate: 75, matches: 20 } as never} />)
      expect(html).toContain(messages.competitionLabels.backhand)
      expect(html).toContain(messages.competitionLabels.rank)
      expect(html).toContain('75%')
      const unknown = render(<PlayerCard player={{ id: 'p', name: 'Test', side: 'PROVIDER_UNKNOWN' }} />)
      expect(unknown).not.toContain('PROVIDER_UNKNOWN')
    })
  })
}

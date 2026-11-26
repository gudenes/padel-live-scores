import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
import { PlayerCard } from '../PlayerCard'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useRouter: vi.fn() }))
vi.mock('@/components/FlagImage', () => ({ FlagImage: () => null }))
const player = { id: 'player', name: 'Test Player', win_rate: 77, total_matches: 229 }
describe('player season card', () => {
  it('shows zero percent and the seasonal count instead of imported career values', () => {
    const html = renderToStaticMarkup(<PlayerCard player={player} seasonStats={{ wins: 0, matches: 4, winRate: 0 }} />)
    expect(html).toContain('>0%</div>')
    expect(html).toContain('>4</div>')
    expect(html).not.toContain('77%')
    expect(html).not.toContain('229')
  })
  it('does not use legacy stats while seasonal data is missing', () => {
    const html = renderToStaticMarkup(<PlayerCard player={player} />)
    expect(html).not.toContain('77%')
    expect(html).not.toContain('229')
  })
})

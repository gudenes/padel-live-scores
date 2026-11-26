import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { MatchStatsView } from '../MatchStatsView'
import { MatchStatsBar } from '../MatchStatsBar'
import type { MatchStatsRow } from '@/lib/premier-stats-parser'
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useInViewOnce', () => ({ useInViewOnce: () => true }))
it('renders provider break conversion without inventing raw opportunity counts', () => {
  const html = renderToStaticMarkup(<MatchStatsBar label="conversion" kind="percentage" t1Value={33} t1Total={100} t2Value={0} t2Total={100} showFraction={false} />)
  expect(html).toContain('33%')
  expect(html).toContain('0%')
  expect(html).not.toContain('33/100')
  expect(html).not.toContain('0/100')
})
it('shows conversion in the summary when present and omits it for legacy missing data', () => {
  const render = (row: Partial<MatchStatsRow>) => renderToStaticMarkup(<MatchStatsView matchId="test" preloaded={{status:'ok',stats:[{set_number:0,...row} as MatchStatsRow]}} />)
  expect(render({team1_break_points_converted_pct:33,team2_break_points_converted_pct:30})).toContain('breakPointConversion')
  expect(render({})).not.toContain('breakPointConversion')
})

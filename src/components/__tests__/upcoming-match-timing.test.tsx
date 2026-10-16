// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import UpcomingMatchCard from '../home/UpcomingMatchCard'
import type { Match } from '@/types/match'
import type { SmartScheduleForecast } from '@/lib/smart-schedule'
const navigate = vi.fn()
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/match/test" onClick={navigate}>{children}</a> }))
vi.mock('@/components/FollowButton', () => ({ default: () => null }))
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }))
vi.mock('next-intl', () => ({
  useLocale: () => 'es',
  useTimeZone: () => 'Europe/Madrid',
  useTranslations: () => (key: string, args?: Record<string, unknown>) => args ? `${key} ${JSON.stringify(args)}` : key,
}))
const now = '2026-10-16T08:00:00Z'
const forecast: SmartScheduleForecast = { version: 1, next_to_play: true, predecessor_id: 'previous', earliest_at: '2026-10-16T08:20:00Z', latest_at: '2026-10-16T08:40:00Z', computed_at: now, source_updated_at: now, basis: 'live_progress' }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); navigate.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })
function card(label: string, smart_schedule: SmartScheduleForecast | null = null) {
  render(<UpcomingMatchCard match={{ id: 'milano', status: 'scheduled', scheduled_at: '2026-10-16T08:30:00Z', schedule_label: label, smart_schedule } as unknown as Match} />)
}
describe('homepage uses the matches-page schedule', () => {
  it('shows the same estimate and next-to-play badge instead of the stored time', () => {
    card('Followed by', forecast)
    expect(screen.getByText('nextToPlay')).toBeTruthy()
    expect(screen.getByText('minutesRange {"min":20,"max":40}')).toBeTruthy()
    expect(screen.queryByText('10:30*')).toBeNull()
  })
  it('opens the shared explanation without navigating the card', () => {
    card('Followed by', forecast)
    fireEvent.click(screen.getByRole('button'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('tooltip').textContent).toContain('10:20–10:40')
    expect(screen.getByRole('tooltip').textContent).toContain('10:30')
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('shows unlikely-before timing for later matches', () => {
    card('Followed by', { ...forecast, next_to_play: false })
    expect(screen.getByText('unlikelyBefore')).toBeTruthy()
    expect(screen.getByText('10:20')).toBeTruthy()
    expect(screen.queryByText('nextToPlay')).toBeNull()
  })
  it('uses the matches-page approximate clock fallback for stale forecasts', () => {
    card('Followed by', { ...forecast, computed_at: '2026-10-16T07:55:00Z' })
    expect(screen.getByText('10:30*')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('marks not-before times and leaves fixed starts unmarked', () => {
    card('Not before 10:30')
    expect(screen.getByText('10:30*')).toBeTruthy()
    cleanup()
    card('Starting at 10:30')
    expect(screen.getByText('10:30')).toBeTruthy()
  })
  it('shows the shared after-previous fallback when the forecast has no window', () => {
    card('Followed by', { ...forecast, earliest_at: null, latest_at: null })
    expect(screen.getByText('afterPrevious')).toBeTruthy()
  })
})

// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import UpcomingMatchCard from '../home/UpcomingMatchCard'
import type { Match } from '@/types/match'
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/FollowButton', () => ({ default: () => null }))
vi.mock('next-intl', () => ({
  useFormatter: () => ({ dateTime: (_: Date, opts: { hour?: string }) => opts.hour ? '10:30' : '16 Oct' }),
  useTranslations: () => (key: string, args?: { time: string }) => ({ followedBy: 'Following the previous match', notBefore: `Not before ${args?.time}`, startTimeTbd: 'Start time TBD' })[key],
}))
afterEach(cleanup)
function card(label: string, scheduled_at: string | null = '2026-10-16T08:30:00Z') {
  render(<UpcomingMatchCard match={{ id: 'milano', status: 'scheduled', scheduled_at, schedule_label: label } as unknown as Match} />)
}
describe('upcoming match timing', () => {
  it('does not present an estimated clock as the confirmed start for followed-by matches', () => {
    card('Followed by')
    expect(screen.getByText('Following the previous match')).toBeTruthy()
    expect(screen.queryByText('10:30')).toBeNull()
  })
  it('preserves not-before semantics', () => {
    card('Not before 10:30')
    expect(screen.getByText('Not before 10:30')).toBeTruthy()
  })
  it('shows a clock for a fixed start and a translated fallback for missing times', () => {
    card('Starting at 10:30')
    expect(screen.getByText('10:30')).toBeTruthy()
    cleanup()
    card('', null)
    expect(screen.getByText('Start time TBD')).toBeTruthy()
  })
})

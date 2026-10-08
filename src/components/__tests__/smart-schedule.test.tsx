// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextToPlayBadge, SmartScheduleHint } from '../SmartSchedule'
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, args?: Record<string, unknown>) => args ? `${key} ${JSON.stringify(args)}` : key }))
const forecast = { version: 1 as const, next_to_play: true, predecessor_id: 'previous', earliest_at: '2026-10-08T10:20Z', latest_at: '2026-10-08T10:40Z', computed_at: '2026-10-08T10:00Z', source_updated_at: '2026-10-08T10:00Z', basis: 'live_progress' as const }
afterEach(cleanup)
describe('smart schedule controls', () => {
  it('shows queue position separately from an estimate', () => {
    render(<><NextToPlayBadge /><SmartScheduleHint forecast={forecast} now={Date.parse(forecast.computed_at)} locale="es" tz="Europe/Madrid" /></>)
    expect(screen.getByText('nextToPlay')).toBeTruthy()
    expect(screen.getByRole('button').textContent).toContain('estimatePrefix')
  })
  it('opens the timing explanation without navigating its wrapping card', () => {
    const navigate = vi.fn()
    render(<a href="/match/test" onClick={navigate}><SmartScheduleHint forecast={forecast} now={Date.parse(forecast.computed_at)} locale="es" tz="Europe/Madrid" scheduledTime="11:30" /></a>)
    fireEvent.click(screen.getByRole('button'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('tooltip').textContent).toContain('12:20–12:40')
    expect(screen.getByRole('tooltip').textContent).toContain('11:30')
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('uses the early clock edge instead of a broad countdown for later matches', () => {
    render(<SmartScheduleHint forecast={{ ...forecast, next_to_play: false }} now={Date.parse(forecast.computed_at)} locale="es" tz="Europe/Madrid" />)
    expect(screen.getByRole('button').textContent).toContain('unlikelyBefore')
    expect(screen.getByRole('button').textContent).toContain('12:20')
    expect(screen.getByRole('button').textContent).not.toContain('minutesRange')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip').textContent).toContain('12:20–12:40')
  })
  it('uses a qualitative fallback when no start window is available', () => {
    render(<SmartScheduleHint forecast={{ ...forecast, earliest_at: null, latest_at: null }} now={Date.parse(forecast.computed_at)} locale="es" tz="Europe/Madrid" />)
    expect(screen.getByRole('button').textContent).toBe('afterPrevious')
  })
})

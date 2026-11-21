// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OperationsDashboard } from '../OperationsDashboard'
vi.mock('../integrations/IntegrationMonitorView', () => ({ IntegrationMonitorView: ({ compact }: { compact?: boolean }) => createElement('div', {}, compact ? 'Service health summary' : 'Detailed integration routes') }))
afterEach(cleanup)
describe('Operations Dashboard', () => {
  it('combines growth and service health in its overview and lets operators open each detail view', () => {
    render(createElement(OperationsDashboard, { summary: 'Growth KPI totals', trends: 'Growth trend chart', growth: 'Full growth panels' }))
    expect(screen.getByRole('heading', { name: 'Operations Dashboard' })).toBeTruthy()
    expect(screen.getByText('Growth KPI totals')).toBeTruthy()
    expect(screen.getByText('Service health summary')).toBeTruthy()
    expect(screen.getByText('Growth trend chart')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Growth & adoption' }))
    expect(screen.getByText('Full growth panels')).toBeTruthy()
    expect(screen.queryByText('Service health summary')).toBeNull()
    expect(window.location.search).toBe('?view=growth')
    fireEvent.click(screen.getByRole('button', { name: 'Integrations & usage' }))
    expect(screen.getByText('Detailed integration routes')).toBeTruthy()
    expect(window.location.search).toBe('?view=integrations')
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByText('Growth KPI totals')).toBeTruthy()
    expect(window.location.search).toBe('')
  })
  it('honors an integration deep link', () => {
    render(createElement(OperationsDashboard, { summary: 'summary', growth: 'growth', initialView: 'integrations' }))
    expect(screen.getByRole('button', { name: 'Integrations & usage' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Detailed integration routes')).toBeTruthy()
  })
})

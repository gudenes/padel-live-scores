// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const resources = vi.hoisted(() => ({ markets: {status: 'ready', data: {markets: [], totalAvailable: 0}, reload: vi.fn()} }))
vi.mock('@/components/AuthProvider', () => ({useAuth: () => ({user: null})}))
vi.mock('./_components/PlayOnboarding', () => ({useOnboarding: () => ({loading: false, progress: {step: 'done'}}), IdentitySetup: () => null, OnboardingGuide: () => null}))
vi.mock('@/components/play-invite/useInvitePrompt', () => ({useInvitePrompt: () => ({})}))
vi.mock('@/components/play-invite/InviteDrawer', () => ({default: () => null}))
vi.mock('@/components/play-results/SettlementResults', () => ({default: () => null}))
vi.mock('next-intl', () => ({useLocale: () => 'en', useTranslations: () => (key: string) => key}))
vi.mock('./_components/usePlayData', () => ({useApiResource: (url: string) => url.includes('/markets') ? resources.markets : {status: 'ready', data: null, reload: vi.fn()}}))
vi.mock('./_components/SubNav', () => ({default: ({active, onSelect}: any) => <nav aria-label={active}><button onClick={() => onSelect('markets')}>Markets</button><button onClick={() => onSelect('mine')}>Mine</button></nav>}))
let PlayPage: typeof import('./page').default
beforeAll(async () => {
 for (const name of ['PlayWelcome', 'FloatingInvite', 'MarketToolbar', 'PlayerWallet', 'MarketFeed', 'ActivityBanner', 'TradeSheet', 'MarketDetailSheet', 'QuickTradeConfirmation', 'PositionsScreen', 'ActivityScreen', 'LeadersScreen']) {
  vi.doMock(`./_components/${name}`, () => ({default: () => null}))
 }
 vi.doMock('@/components/nav/GlobalHeader', () => ({default: () => null}))
 vi.doMock('./_components/shared', () => ({Blank: () => null, Press: () => null, SkeletonList: () => null}))
 PlayPage = (await import('./page')).default
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/play'); resources.markets = {status: 'ready', data: {markets: [], totalAvailable: 0}, reload: vi.fn()} })
it('opens Leaders with no markets and allows manually returning to Markets', async () => {
 render(<PlayPage />)
 await waitFor(() => expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('leaders'))
 fireEvent.click(screen.getByText('Markets'))
 expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('markets')
})
it('preserves direct links to positions', () => {
 window.history.replaceState({}, '', '/play?view=mine')
 render(<PlayPage />)
 expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('mine')
})
it('does not mistake a failed market request for no markets', () => {
 resources.markets.status = 'error'
 render(<PlayPage />)
 expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('markets')
})
it('does not override navigation made while markets load', () => {
 resources.markets.status = 'loading'
 const view = render(<PlayPage />)
 fireEvent.click(screen.getByText('Mine'))
 resources.markets.status = 'ready'
 view.rerender(<PlayPage />)
 expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('mine')
})

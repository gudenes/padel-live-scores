// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type {PlayMarket} from './_components/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const requests = vi.hoisted(() => ({ urls: [] as string[] }))
const resources = vi.hoisted(() => ({ markets: {status: 'ready', data: {markets: [] as PlayMarket[], totalAvailable: 0, unplayedCount: 0, playedMarketIds: [] as string[]}, reload: vi.fn()} }))
vi.mock('@/components/AuthProvider', () => ({useAuth: () => ({user: null})}))
vi.mock('./_components/PlayOnboarding', () => ({useOnboarding: () => ({loading: false, progress: {step: 'done'}}), IdentitySetup: () => null, OnboardingGuide: () => null}))
vi.mock('@/components/play-invite/useInvitePrompt', () => ({useInvitePrompt: () => ({afterPrediction:vi.fn()})}))
vi.mock('@/components/play-invite/InviteDrawer', () => ({default: () => null}))
vi.mock('@/components/play-results/SettlementResults', () => ({default: () => null}))
vi.mock('next-intl', () => ({useLocale: () => 'en', useTranslations: () => (key: string) => key}))
vi.mock('./_components/usePlayData', () => ({useApiResource: (url: string) => { requests.urls.push(url); return url.includes('/markets') ? resources.markets : {status: 'ready', data: null, reload: vi.fn()} }}))
vi.mock('./_components/SubNav', () => ({default: ({active, onSelect, availableCount}: {availableCount?:number; active: string; onSelect: (key: 'markets' | 'mine') => void}) => <nav aria-label={active} data-count={availableCount}><button onClick={() => onSelect('markets')}>Markets</button><button onClick={() => onSelect('mine')}>Mine</button></nav>}))
let PlayPage: typeof import('./page').default
beforeAll(async () => {
 for (const name of ['PlayWelcome', 'FloatingInvite', 'MarketToolbar', 'PlayerWallet', 'ActivityBanner', 'MarketDetailSheet', 'QuickTradeConfirmation', 'PositionsScreen', 'ActivityScreen', 'LeadersScreen']) {
  vi.doMock(`./_components/${name}`, () => ({default: () => null}))
 }
 vi.doMock('./_components/MarketFeed',()=>({default:({markets,onChoose}:any)=><button onClick={()=>onChoose(markets[0],'yes')}>Pick market</button>}))
 vi.doMock('./_components/TradeSheet',()=>({default:({onConfirm}:any)=><button onClick={()=>onConfirm(100,'yes')}>Confirm play</button>}))
 vi.doMock('@/components/nav/GlobalHeader', () => ({default: () => null}))
 vi.doMock('./_components/shared', () => ({Blank: () => null, Press: () => null, SkeletonList: () => null}))
 PlayPage = (await import('./page')).default
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); requests.urls = []; window.history.replaceState({}, '', '/play'); resources.markets = {status: 'ready', data: {markets: [] as PlayMarket[], totalAvailable: 0, unplayedCount: 0, playedMarketIds: [] as string[]}, reload: vi.fn()} })
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

it('clears a closed match restriction when returning to Markets, including on reload', () => {
 const match = '544c607a-bbda-460a-84cc-55519db5e582'
 window.history.replaceState({preserved: true}, '', `/play?match=${match}&locale=en#markets`)
 resources.markets.data.totalAvailable = 10
 const view = render(<PlayPage />)
 const lastMarketUrl = () => requests.urls.filter(url => url.includes('/markets')).at(-1)
 expect(lastMarketUrl()).toContain(`matchId=${match}`)
 fireEvent.click(screen.getByText('Mine'))
 fireEvent.click(screen.getByText('Markets'))
 expect(lastMarketUrl()).toBe('/api/play/markets?locale=en')
 expect(window.location.search).toBe('?locale=en')
 expect(window.location.hash).toBe('#markets')
 expect(window.history.state).toEqual({preserved: true})
 view.unmount()
 render(<PlayPage />)
 expect(lastMarketUrl()).toBe('/api/play/markets?locale=en')
})

it('shows only unplayed opportunities in the tab while keeping played markets accessible',()=>{
 resources.markets.data.totalAvailable=10
 resources.markets.data.unplayedCount=7
 render(<PlayPage />)
 expect(screen.getByRole('navigation').getAttribute('data-count')).toBe('7')
 expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('markets')
})

it('deducts a successful first play immediately, reconciles refresh, and does not deduct repeat plays',async()=>{
 resources.markets.data={markets:[{id:'new',question:'Test market'} as PlayMarket],totalAvailable:10,unplayedCount:7,playedMarketIds:[]}
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ok:true,shares:200,cost:100})))
 const view=render(<PlayPage />)
 fireEvent.click(screen.getByText('Pick market'))
 fireEvent.click(screen.getByText('Confirm play'))
 await waitFor(()=>expect(screen.getByRole('navigation').getAttribute('data-count')).toBe('6'))
 resources.markets.data={...resources.markets.data,unplayedCount:6,playedMarketIds:['new']}
 view.rerender(<PlayPage />)
 expect(screen.getByRole('navigation').getAttribute('data-count')).toBe('6')
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({ok:true,shares:200,cost:100}))
 fireEvent.click(screen.getByText('Pick market'))
 fireEvent.click(screen.getByText('Confirm play'))
 await waitFor(()=>expect(screen.queryByText('Confirm play')).toBeNull())
 expect(screen.getByRole('navigation').getAttribute('data-count')).toBe('6')
})
it('does not reduce the remaining count when a trade fails',async()=>{
 resources.markets.data={markets:[{id:'new'} as PlayMarket],totalAvailable:10,unplayedCount:7,playedMarketIds:[]}
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'market_locked'},{status:409})))
 render(<PlayPage />)
 fireEvent.click(screen.getByText('Pick market'));fireEvent.click(screen.getByText('Confirm play'))
 await waitFor(()=>expect(fetch).toHaveBeenCalled())
 expect(screen.getByRole('navigation').getAttribute('data-count')).toBe('7')
})

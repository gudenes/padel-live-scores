// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import PositionsScreen from './PositionsScreen'
import type { PlayPosition } from './types'
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
afterEach(cleanup)
const base: PlayPosition = {marketId:'one',publicId:'one',question:'Will the pair win?',context:'Men',live:false,status:'open',side:'yes',shares:200,costBasis:100,avgPrice:.5,currentPrice:.6,valueNow:120,deltaPct:20}
it('separates pending choices from final results and labels amounts', () => {
 const positions:PlayPosition[]=[base,{...base,marketId:'two',question:'Will there be three sets?',status:'settled',result:'won',valueNow:200}]
 render(<NextIntlClientProvider locale="en" messages={messages}><PositionsScreen me={{balance:500,locked:100,netWorth:620,positions}} status="ready" onExplore={vi.fn()} onRetry={vi.fn()}/></NextIntlClientProvider>)
 expect(screen.getByText('Pending', {selector:'span'})).toBeTruthy()
 expect(screen.getByLabelText('Guacas played 100')).toBeTruthy()
 expect(screen.queryByText(/20%|0.50|Live now/)).toBeNull()
 expect(screen.queryByText('Will there be three sets?')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:/Results 1/i}))
 expect(screen.getByText('Will there be three sets?')).toBeTruthy()
 expect(screen.getByTitle('Total returned')).toBeTruthy()
 expect(screen.queryByText('Will the pair win?')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:/All 2/i}))
 expect(screen.getByText('Will the pair win?')).toBeTruthy()
})

it('sorts pending plays by known dates, leaves undated last, and floors the conditional payout', () => {
 const positions:PlayPosition[]=[{...base,marketId:'late',question:'Late',resolutionAt:'2026-11-30T23:59:59Z',resolutionKind:'window'}, {...base,marketId:'unknown',question:'Unknown'}, {...base,marketId:'early',question:'Early',matchLabel:'Sanz / Stupaczuk vs Galan / Chingotto',resolutionAt:'2026-10-03T12:00:00Z',resolutionKind:'match',shares:234.9}]
 const {container}=render(<NextIntlClientProvider locale="en" messages={messages}><PositionsScreen me={{balance:500,locked:100,netWorth:620,positions}} status="ready" onExplore={vi.fn()} onRetry={vi.fn()}/></NextIntlClientProvider>)
 expect([...container.querySelectorAll('h4')].map(e=>e.textContent)).toEqual(['Early','Late','Unknown'])
 expect(screen.getByText('Sanz / Stupaczuk vs Galan / Chingotto')).toBeTruthy()
 expect(screen.getByText('234')).toBeTruthy()
 expect(screen.getByTitle(/After the match/)).toBeTruthy()
 expect(screen.getByTitle(/Result window ends/)).toBeTruthy()
})

it('sorts results newest first and groups by settlement date', () => {
 const positions:PlayPosition[]=[{...base,marketId:'old',question:'Old result',status:'settled',result:'lost',settledAt:'2026-09-20T12:00:00Z',valueNow:0},{...base,marketId:'new',question:'New result',status:'settled',result:'won',settledAt:'2026-09-22T12:00:00Z',valueNow:200}]
 const {container}=render(<NextIntlClientProvider locale="en" messages={messages}><PositionsScreen me={{balance:500,locked:0,netWorth:500,positions}} status="ready" onExplore={vi.fn()} onRetry={vi.fn()}/></NextIntlClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Results 2'}))
 expect([...container.querySelectorAll('h4')].map(e=>e.textContent)).toEqual(['New result','Old result'])
 expect(container.querySelectorAll('h3').length).toBe(2)
 expect(screen.getByLabelText('Received 0')).toBeTruthy()
})

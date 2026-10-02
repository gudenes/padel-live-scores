// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { groupMarkets } from './group-markets'
import { parseMarkets } from './types'
import MarketFeed from './MarketFeed'
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
vi.mock('next/image',()=>({default:({fill,sizes,...props}:any)=><img {...props}/>}))
afterEach(cleanup)
const markets=()=>parseMarkets({markets:[
 {id:'winner',matchId:'match1',question:'Will pair two win?',subtitle:'Pair one vs Pair two',resolverKey:'match.winner_is_pair',subjectPair:2,competition:'Rotterdam',categoryLabel:'Women',roundLabel:'Quarterfinal',priceYes:.5,book:{qYes:0,qNo:0,b:1000}},
 {id:'sets',matchId:'match1',question:'Will it go to three sets?',resolverKey:'match.went_to_three_sets',priceYes:.5,book:{qYes:0,qNo:0,b:1000}},
 {id:'other',matchId:'match2',question:'Another match',priceYes:.5},
 {id:'season1',question:'Season question',priceYes:.5,horizon:'season'},
 {id:'season2',question:'Season question',priceYes:.5,horizon:'season'}]})
it('groups only identical match ids and keeps unrelated season questions distinct',()=>{
 const groups=groupMarkets(markets(),[])
 expect(groups.map(g=>g.questions.map(m=>m.id))).toEqual([['winner','sets'],['other'],['season1'],['season2']])
})
it('keeps partially played matches above fully played matches',()=>{
 const positions=[{marketId:'winner',shares:10},{marketId:'other',shares:10}] as any
 expect(groupMarkets(markets(),positions).map(g=>g.id)).toEqual(['match:match1','market:season1','market:season2','match:match2'])
})
it('preserves each exact question, side and details target in a shared card',()=>{
 const choose=vi.fn(),detail=vi.fn(), ms=markets().slice(0,2)
 render(<NextIntlClientProvider locale="en" messages={messages}><MarketFeed markets={ms} positions={[]} onChoose={choose} onDetail={detail} onViewPositions={()=>{}}/></NextIntlClientProvider>)
 expect(screen.getAllByRole('article')).toHaveLength(1)
 for(const label of ['Rotterdam','Women','QF'])expect(screen.getByText(label)).toBeTruthy()
 const yes=screen.getByRole('button',{name:/^Yes · Will pair two win/})
 expect(yes.getAttribute('data-team')).toBe('2')
 fireEvent.click(yes);expect(choose).toHaveBeenLastCalledWith(ms[0],'yes')
 const no=screen.getByRole('button',{name:/^No · Will pair two win/})
 expect(no.getAttribute('data-team')).toBe('1')
 fireEvent.click(screen.getByRole('button',{name:/^No · Will it go/}));expect(choose).toHaveBeenLastCalledWith(ms[1],'no')
 fireEvent.click(screen.getByRole('button',{name:/^Details · Will it go/}));expect(detail).toHaveBeenLastCalledWith(ms[1])
 expect(screen.getAllByRole('link',{name:'View match'})).toHaveLength(1)
})

it('hides choices only for the invested question and keeps the other question playable',()=>{
 const ms=markets().slice(0,2)
 const positions=[{marketId:'winner',side:'yes',shares:10,cost:100}] as any
 render(<NextIntlClientProvider locale="en" messages={messages}><MarketFeed markets={ms} positions={positions} onChoose={()=>{}} onDetail={()=>{}} onViewPositions={()=>{}}/></NextIntlClientProvider>)
 expect(screen.queryByRole('button',{name:/^Yes · Will pair two win/})).toBeNull()
 expect(screen.queryByRole('button',{name:/^No · Will pair two win/})).toBeNull()
 expect(screen.getByRole('button',{name:/^Details · Will pair two win/})).toBeTruthy()
 expect(screen.getByRole('button',{name:/^Yes · Will it go/})).toBeTruthy()
})

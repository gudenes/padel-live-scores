// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import MatchLink from './MatchLink'
import PositionsScreen from './PositionsScreen'
import {parseMe,parseMarkets} from './types'
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
afterEach(cleanup)
const wrap=(child:React.ReactNode)=><NextIntlClientProvider locale="en" messages={messages}>{child}</NextIntlClientProvider>
it('links a live market to its match without triggering its parent action',()=>{
 const choose=vi.fn();render(wrap(<div onClick={choose}><MatchLink matchId="match-1" live/></div>))
 const link=screen.getByRole('link',{name:/Follow live/});expect(link.getAttribute('href')).toBe('/match/match-1');fireEvent.click(link);expect(choose).not.toHaveBeenCalled()
})
it('does not invent a match destination for season markets',()=>{
 const {container}=render(wrap(<MatchLink live={false}/>));expect(container.querySelector('a')).toBeNull()
})
it('preserves match ids in API parsing',()=>{
 expect(parseMarkets({markets:[{id:'market',matchId:'match',priceYes:.5} ]})[0].matchId).toBe('match')
})
it('filters to live plays and counts each match once',()=>{
 const positions=[{marketId:'a',matchId:'match-1',question:'Live yes',side:'yes',avgPrice:.5,currentPrice:.5,shares:10,status:'locked',live:true},{marketId:'a',matchId:'match-1',question:'Live no',side:'no',avgPrice:.5,currentPrice:.5,shares:10,status:'locked',live:true},{marketId:'b',matchId:'match-2',question:'Scheduled pick',side:'yes',avgPrice:.5,currentPrice:.5,shares:10,status:'open',live:false}]
 const me=parseMe({positions,balance:100,netWorth:100})
 render(wrap(<PositionsScreen me={me} status="ready" onExplore={()=>{}} onRetry={()=>{}}/>))
 fireEvent.click(screen.getByRole('button',{name:'Live now · 1'}));expect(screen.queryByText('Scheduled pick')).toBeNull();expect(screen.getByText('Live yes')).toBeTruthy();expect(screen.getAllByRole('link',{name:/Follow live/})).toHaveLength(2)
 fireEvent.click(screen.getByRole('button',{name:'Live now · 1'}));expect(screen.getByText('Scheduled pick')).toBeTruthy()
})

// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import MatchPlayNavigation from './MatchPlayNavigation'
vi.mock('@/components/AuthProvider',()=>({useAuth:()=>({user:{id:'member'}})}))
vi.mock('@/i18n/navigation',()=>({Link:({href,children}:any)=><a href={href}>{children}</a>}))
vi.mock('@/components/GuacaCoin',()=>({default:()=> <span>Guacas</span>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const mount=()=>render(<NextIntlClientProvider locale="en" messages={messages}><MatchPlayNavigation matchId="match-1"/></NextIntlClientProvider>)
const position={marketId:'market-1',matchId:'match-1',question:'Will this match go to 3 sets?',avgPrice:.5,currentPrice:.5,shares:200,costBasis:100,side:'yes',status:'locked',result:'pending'}
it('shows only held positions for this match, even after trading closes',async()=>{
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve({ok:true,json:async()=>url.includes('/me?')?{positions:[position,{...position,marketId:'other',matchId:'match-2',question:'Other match'}]}:{markets:[]}})))
 mount();expect(await screen.findByText('Your plays · 1')).toBeTruthy();expect(screen.getByText(position.question)).toBeTruthy();expect(screen.queryByText('Other match')).toBeNull();expect(screen.getByText('Pending')).toBeTruthy()
})
it('hides the panel when access is denied',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:false});vi.stubGlobal('fetch',fetch);const {container}=mount();await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(container.querySelector('details')).toBeNull();expect(screen.queryByRole('link')).toBeNull()
})
it('links unplayed available markets to the matching Play card',async()=>{
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve({ok:true,json:async()=>url.includes('/me?')?{positions:[]}:{markets:[{id:'market-1'}]}})))
 mount();expect((await screen.findByRole('link',{name:'Make a prediction'})).getAttribute('href')).toBe('/play?match=match-1')
})

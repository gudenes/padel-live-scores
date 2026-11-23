// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import type {PlayLeaderboard} from './types'
vi.stubGlobal('React',React)
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('./useMemberFollows',()=>({useMemberFollows:()=>({ids:[],ready:true,error:false,busy:false,toggle:vi.fn()})}))
vi.mock('@/components/player/MemberAvatar',()=>({MemberAvatar:()=>null}))
vi.mock('@/components/PlayerAvatar',()=>({PlayerAvatar:()=>null,PlayerFigure:()=>null}))
vi.mock('@/components/play-invite/InviteDrawer',()=>({default:()=> <div role="dialog">Invite friends</div>}))
import LeadersScreen from './LeadersScreen'
afterEach(cleanup)
it('offers invites with only the own row, and Find players opens Global search',()=>{
 const row={userId:'me',displayName:'Myself',isMe:true,rank:1,netWinnings:0,move:null,accuracy:null,streak:null,isSimulation:false,avatarUrl:null}
 const board={rows:[row,{...row,userId:'other',displayName:'Other player',isMe:false,rank:2}],me:row,weekOffset:0} as unknown as PlayLeaderboard
 render(<NextIntlClientProvider locale="en" messages={messages}><LeadersScreen active board={board} status="ready" period="week" onPeriod={()=>{}} onRetry={()=>{}}/></NextIntlClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Friends'}))
 expect(screen.getByText(messages.play.leaders.noFollowing)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:messages.play.invite.inviteFriends}))
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:messages.play.leaders.findPlayers}))
 expect(screen.getByRole('button',{name:'Global'}).getAttribute('aria-pressed')).toBe('true')
 const input=screen.getByRole('searchbox')
 expect(document.activeElement).toBe(input)
 fireEvent.change(input,{target:{value:'Other'}})
 expect(screen.getByText('Other player')).toBeTruthy()
})

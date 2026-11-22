// @vitest-environment jsdom
import React from 'react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {NextIntlClientProvider} from 'next-intl'
import messages from '@/messages/en.json'
import RaceStandings from './RaceStandings'
import type {RaceSnapshot,RacePlayer} from '@/lib/live-race/types'
vi.mock('@/i18n/navigation',()=>({Link:({children,href,...props}:React.ComponentProps<'a'>)=><a href={href} {...props}>{children}</a>}))
afterEach(cleanup)
const players:RacePlayer[]=Array.from({length:80},(_,i)=>({id:`p${i}`,name:`Player ${i+1}`,country:'ES',avatar_url:null,category:'men',race_ranking:i+1,race_points:800-i*5,officialPoints:780-i*5,officialRank:i+2,liveGain:20,pending:false}))
const snapshot:RaceSnapshot={version:1,gender:'men',players,baselineDate:'2026-11-16',checkedAt:'2026-11-22T10:00:00Z',computedAt:'2026-11-22T10:00:00Z',totalPlayers:80,appliedPlayers:80,pendingPlayers:0,resultCount:20,status:'live',reconciliation:null}
function show(query='',data:RaceSnapshot|null=snapshot){render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><RaceStandings players={players} gender="men" baselineDate="16 November 2026" snapshot={data} query={query}/></NextIntlClientProvider>)}
describe('real Race standings',()=>{
 it('switches to official points and rank without losing any players',()=>{
  show(); const toggle=screen.getByRole('switch', {name:'Live'});
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getAllByRole('link')).toHaveLength(80);
  expect(screen.getAllByRole('link')[0].textContent).toContain('780');
  expect(screen.getAllByRole('link')[0].textContent).not.toContain('+20');
  fireEvent.click(screen.getByRole('button', {name:'How Race points work'}));
  expect(screen.getByRole('tooltip').textContent).toContain('Official Race standings');
  fireEvent.keyDown(screen.getByRole('button', {name:'How Race points work'}), {key:'Escape'});
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getAllByRole('link')[0].textContent).toContain('800');
 })
 it('shows the full list from first through last, not a bubble or 50-row slice',()=>{
  show();expect(screen.getByText('Player 1')).toBeTruthy();expect(screen.getByText('Player 80')).toBeTruthy();expect(screen.getByText('80 ranked players')).toBeTruthy();expect(screen.getAllByRole('link')).toHaveLength(80)
  expect(screen.getByText('Premier Finals')).toBeTruthy();expect(screen.queryByText(/Illustrative/)).toBeNull()
 })
 it('searches beyond the first page and hides the cutoff in filtered results',()=>{show('Player 80');expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.queryByText('Premier Finals')).toBeNull()})
 it('never labels stale provisional scores as official',()=>{show('',{...snapshot,status:'stale'});fireEvent.click(screen.getByRole('button', {name:'How Race points work'}));expect(screen.getByText('Provisional standings')).toBeTruthy();expect(screen.getAllByText(/Updates delayed/).length).toBeGreaterThan(0);expect(screen.queryByText('Official Race standings')).toBeNull()})
})

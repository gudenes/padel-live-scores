// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react'
import SavedScoutingReport from '../../app/(app)/scouting/[id]/report/SavedScoutingReport'
import {freshDoc} from '../scouting/model'
vi.mock('next/link',()=>({default:(props:Record<string,unknown>)=>createElement('a',props)}))
const players=['One','Two','Three','Four'].map((name,i)=>({id:String(i),name}))
const snap=(time:number)=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',page:'https://youtube.com/watch?v=v',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'})
const row={players,revision:1,updated_at:'2026-10-06T00:00:00Z',document:{version:1,label:'Test',cancelled:[],pending:null,setup:{names:players.map(p=>p.name),firstServer:0,otherServer:2,rule:'star-point',startingScore:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:0},server:0,near:'a',advantageReturns:0}},rallies:[{id:'last',varReviewed:true,start:snap(100),end:snap(110),point:{player:0,outcome:'winner',shot:'smash',smashType:'power',x4:true}}]}}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('opens the saved extension insights without posting or creating admin scouting',async()=>{
 const fetch=vi.fn(async(_url:unknown,_options?:RequestInit)=>Response.json({session:row}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'match'}))
 await screen.findByText('Match finished');expect(screen.getByText(/1 points observed/)).toBeTruthy()
 expect(screen.queryByRole('link',{name:'View public match report'})).toBeNull()
 expect(screen.getByRole('button',{name:/VAR review/})).toBeTruthy()
 const smash=screen.getByRole('region',{name:'Smashes and shot directions'})
 expect(within(smash).getByText('X4 winners')).toBeTruthy();expect(screen.getByRole('slider',{name:'Explore match point'})).toBeTruthy()
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]).not.toHaveProperty('method')
 fireEvent.click(screen.getByRole('button',{name:'Refresh server copy'}));await screen.findByText('Match finished');expect(fetch).toHaveBeenCalledTimes(2)
})
it('falls back to the existing admin insights when no extension session exists',async()=>{
 const fetch=vi.fn(async(url:string)=>Response.json({session:url.includes('video-scouting')?null:{...row,document:freshDoc()}}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'native'}));await screen.findByText('Scouting in progress')
 expect(screen.getByText(/Admin scouting · server revision/)).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2)
})
it('shows sync guidance for empty sessions and a retry for server failures',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({session:null})))
 render(createElement(SavedScoutingReport,{matchId:'empty'}));await screen.findByText('No saved scouting for this match')
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Sign in to admin as an operator.'},{status:401})))
 fireEvent.click(screen.getByRole('button',{name:'Refresh server copy'}))
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Sign in to admin as an operator.')
})
it('reads private scouting insights and metadata without querying public matches or creating records',async()=>{
 const fetch=vi.fn(async(_url:string)=>Response.json({session:row,match:{match_date:'2018-10-08',tournament_label:'Historical replay'}}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'private',manual:true}));await screen.findByText('Match finished')
 expect(screen.getByText(/Private scouting · manually created · 2018-10-08 · Historical replay/)).toBeTruthy()
 expect(screen.getByRole('link',{name:'← Private scouting matches'}).getAttribute('href')).toBe('/scouting/matches')
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/internal/manual-video-scouting/private')
 expect(screen.queryByRole('link',{name:'Open admin scouting'})).toBeNull()
})

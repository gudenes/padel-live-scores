// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import SavedScoutingReport from '../../app/(scouting)/scouting/[id]/report/SavedScoutingReport'
import {freshDoc} from '../scouting/model'
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>'/scouting/test/report',useSearchParams:()=>new URLSearchParams()}))
vi.mock('next/link',()=>({default:(props:Record<string,unknown>)=>createElement('a',props)}))
const players=['One','Two','Three','Four'].map((name,i)=>({id:String(i),name}))
const snap=(time:number)=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',page:'https://youtube.com/watch?v=v',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'})
const row={players,revision:1,updated_at:'2026-10-06T00:00:00Z',document:{version:1,label:'Test',cancelled:[],pending:null,setup:{names:players.map(p=>p.name),firstServer:0,otherServer:2,rule:'star-point',startingScore:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:0},server:0,near:'a',advantageReturns:0}},rallies:[{id:'last',varReviewed:true,start:snap(100),end:snap(110),point:{player:0,outcome:'winner',shot:'smash',smashType:'power',x4:true}}]}}
beforeEach(()=>{vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}});vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null)})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('opens the saved extension insights without posting or creating admin scouting',async()=>{
 const fetch=vi.fn(async(_url:unknown,_options?:RequestInit)=>Response.json({session:row}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'match'}))
 await screen.findByText('1 observed points');expect(screen.getByText(/One \/ Two won/)).toBeTruthy()
 expect(screen.queryByRole('link',{name:'View public match report'})).toBeNull()
 expect(screen.queryByText(/The score includes a starting score/)).toBeNull()
 expect(document.querySelector('.rm-score-point')?.tagName).toBe('DIV')
 expect(document.querySelector('.rm-score-point')?.getAttribute('title')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Data coverage'}))
 expect(screen.getByText(/The score includes a starting score/)).toBeTruthy()
 fireEvent.click(screen.getByLabelText('Export match data'));expect(screen.getByRole('button',{name:'All match data (JSON)'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Reports'}));expect(screen.getByRole('slider',{name:'Explore match point'})).toBeTruthy()
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]).not.toHaveProperty('method')
 fireEvent.click(screen.getByRole('button',{name:'Refresh server copy'}));await screen.findByText('1 observed points');expect(fetch).toHaveBeenCalledTimes(2)
})
it('falls back to the existing admin insights when no extension session exists',async()=>{
 const fetch=vi.fn(async(url:string)=>Response.json({session:url.includes('video-scouting')?null:{...row,document:freshDoc()}}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'native'}));await screen.findByText('0 observed points')
 expect(screen.getByText(/Statistics cover saved observations/)).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2)
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
 render(createElement(SavedScoutingReport,{matchId:'private',manual:true}));await screen.findByText('1 observed points')
 expect(screen.getByText(/Private scouting · Historical replay · 2018-10-08/)).toBeTruthy()
 expect(screen.getByRole('link',{name:'← Back to matches'})).toBeTruthy()
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/internal/manual-video-scouting/private')
 expect(screen.queryByRole('link',{name:'Open admin scouting'})).toBeNull()
})
it('opens PBP-only insights and marks scouting widgets unavailable without creating a session',async()=>{
 const context={meta:{duration:'01:30',round:'Final',category:'men',tournament:'Example',scheduled_at:null},avatars:{},players,sets:[{a:6,b:4}],status:'finished',winnerPair:1,pbp:[{id:'point',game_id:'game',set_number:1,game_number:1,point_number:1,winner_pair:1,score_after:'15-0',server_player_id:null}],games:[{id:'game',set_number:1,game_number:1,winner_pair:1,server_player_id:null,is_tiebreak:false}]}
 const fetch=vi.fn(async(_url:unknown,_options?:RequestInit)=>Response.json({session:null}));vi.stubGlobal('fetch',fetch)
 render(createElement(SavedScoutingReport,{matchId:'pbp',context}));await screen.findByText('1 PBP records · No scouting')
 expect(screen.getByRole('heading',{name:'Match momentum'})).toBeTruthy();expect(screen.queryByText('No saved scouting for this match')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Player performance'}));expect(screen.getAllByText('Not available')).toHaveLength(2)
 fireEvent.click(screen.getByLabelText('Export match data'));expect(screen.getByRole('button',{name:'Scouted points (CSV)'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Official PBP (CSV)'})).toHaveProperty('disabled',false)
 expect(fetch).toHaveBeenCalledTimes(2);for(const call of fetch.mock.calls)expect(call[1]).not.toHaveProperty('method')
})

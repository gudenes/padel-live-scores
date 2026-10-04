// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import Scout from '../../app/(app)/scouting/[id]/Scout'
import {freshDoc} from '../scouting/model'
vi.mock('next/link',()=>({default:(props:Record<string,unknown>)=>createElement('a',props)}))
const players=['One','Two','Three','Four'].map((name,i)=>({id:String(i),name}))
beforeEach(()=>{vi.restoreAllMocks();const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k),clear:()=>storage.clear()})})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('recovers roster and observation history after an offline reload',async()=>{
 localStorage.setItem('pn-scout-v1:offline',JSON.stringify({players,revision:3,document:freshDoc()}))
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')))
 render(createElement(Scout,{matchId:'offline'}))
 await screen.findByText(/Working from your local recovery copy/)
 fireEvent.keyDown(window,{code:'Space',key:' '})
 await screen.findByRole('button',{name:'Rally in progress'})
 expect(JSON.parse(localStorage.getItem('pn-scout-v1:offline')!).document.events[0].kind).toBe('rally_start')
 expect(JSON.parse(localStorage.getItem('pn-scout-v1:offline')!).players).toEqual(players)
})
it('Space never records a fault on a focused button or starts an extra rally',async()=>{
 let revision=1
 const fetch=vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==='POST'?{revision:++revision}:{players,session:{revision,document:freshDoc()}}))
 vi.stubGlobal('fetch',fetch);render(createElement(Scout,{matchId:'keys'}))
 await screen.findByRole('button',{name:'Start rally Space'})
 fireEvent.keyDown(window,{code:'Space',key:' '})
 const fault=await screen.findByRole('button',{name:'First-serve fault'})
 fireEvent.keyDown(fault,{code:'Space',key:' '});fireEvent.keyUp(fault,{code:'Space',key:' '})
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('pn-scout-v1:keys')!).document.events).toHaveLength(1))
 expect((screen.getByRole('button',{name:'Double fault'}) as HTMLButtonElement).disabled).toBe(true)
})
it('blocks further input when another window has changed the session',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,opts?:RequestInit)=>opts?.method==='POST'?Response.json({error:'Session changed'},{status:409}):Response.json({players,session:{revision:1,document:freshDoc()}})))
 render(createElement(Scout,{matchId:'conflict'}));await screen.findByRole('button',{name:'Start rally Space'});fireEvent.keyDown(window,{code:'Space',key:' '})
 await screen.findByText('Session changed');expect((screen.getByRole('button',{name:'First-serve fault'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByRole('button',{name:'Download local copy'})).toBeTruthy()
})
it('records pair arrivals before showing servers and prevents Space from starting early',async()=>{
 let revision=0
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==='POST'?{revision:++revision}:{players,session:null})))
 render(createElement(Scout,{matchId:'arrivals'}))
 await screen.findByRole('heading',{name:'1. Pairs on court'})
 expect(screen.queryByLabelText('First server')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Mark pair A on court'}))
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('pn-scout-v1:arrivals')!).document.events).toHaveLength(1))
 fireEvent.keyDown(window,{code:'Space',key:' '})
 expect(JSON.parse(localStorage.getItem('pn-scout-v1:arrivals')!).document.events).toHaveLength(1)
 expect((screen.getByRole('button',{name:'Next: servers & positions'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Mark pair B on court'}))
 fireEvent.click(screen.getByRole('button',{name:'Next: servers & positions'}))
 expect(screen.getByRole('heading',{name:'2. Servers & positions'})).toBeTruthy()
 fireEvent.change(screen.getByLabelText('First server'),{target:{value:'3'}})
 fireEvent.click(screen.getByRole('button',{name:'Confirm court & start scouting'}))
 await screen.findByRole('button',{name:'Start rally Space'})
 const document=JSON.parse(localStorage.getItem('pn-scout-v1:arrivals')!).document
 expect(document.events.map((e:{kind:string})=>e.kind)).toEqual(['pair_arrived','pair_arrived','court_setup'])
 expect(document.events[2].settings.firstServer).toBe(3)
 await waitFor(()=>expect(screen.getByText('Saved')).toBeTruthy())
})
it('restores saved arrivals after a reload without exposing the live court',async()=>{
 const document={...freshDoc(),preparation:true,events:[{id:'arrival',at:'2026-10-04T12:00:00Z',kind:'pair_arrived',team:'a'}]}
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({players,session:{revision:1,document}})))
 render(createElement(Scout,{matchId:'restore-arrival'}))
 await screen.findByText('On court')
 expect(screen.queryByRole('button',{name:'Mark pair A on court'})).toBeNull()
 expect(screen.getByRole('button',{name:'Mark pair B on court'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Start rally Space'})).toBeNull()
})

it('changes server directly on the court during a second serve and supports undo',async()=>{
 let revision=1
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,opts?:RequestInit)=>Response.json(opts?.method==='POST'?{revision:++revision}:{players,session:{revision,document:freshDoc()}})))
 render(createElement(Scout,{matchId:'change-server'}))
 await screen.findByRole('button',{name:'Start rally Space'})
 fireEvent.keyDown(window,{code:'Space',key:' '})
 fireEvent.click(screen.getByRole('button',{name:'First-serve fault'}))
 expect((screen.getByLabelText('Server') as HTMLSelectElement).disabled).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'Set Three as server'}))
 expect(screen.getByText('Three · Second serve')).toBeTruthy()
 expect((screen.getByRole('button',{name:'Rally in progress'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByText('Server changed to Three · current rally kept')).toBeTruthy()
 expect((screen.getByRole('button',{name:'Double fault'}) as HTMLButtonElement).disabled).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'Undo last action'}))
 expect(screen.getByText('One · Second serve')).toBeTruthy()
 await waitFor(()=>expect(screen.getByText('Saved')).toBeTruthy())
})

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

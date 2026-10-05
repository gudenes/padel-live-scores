// @vitest-environment jsdom
import {act,renderHook,waitFor,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useInvitePrompt} from './useInvitePrompt'
beforeEach(()=>{const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({eligible:true})}))})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('waits until confirmation and guidance finish',async()=>{
 const {result,rerender}=renderHook(({blocked})=>useInvitePrompt('first',blocked),{initialProps:{blocked:true}})
 await act(async()=>{await result.current.afterPrediction()})
 expect(result.current.open).toBe(false)
 rerender({blocked:false});await waitFor(()=>expect(result.current.open).toBe(true))
 act(()=>result.current.close());await act(async()=>{await result.current.afterPrediction()})
 expect(result.current.open).toBe(false)
})
it('never prompts existing players',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({eligible:false})} as Response)
 const {result}=renderHook(()=>useInvitePrompt('existing',false))
 await act(async()=>{await result.current.afterPrediction()})
 expect(result.current.open).toBe(false)
})
it('manual entry stays available after dismissing',()=>{
 localStorage.setItem('pn:invite-first-play:me','seen')
 const {result}=renderHook(()=>useInvitePrompt('me',false))
 act(()=>window.dispatchEvent(new Event('pn:invite-play')))
 expect(result.current.open).toBe(true)
})

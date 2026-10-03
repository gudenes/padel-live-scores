// @vitest-environment jsdom
import React, { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useWalletMotion } from './useWalletMotion'
let reduced=false
let callbacks:Map<number,FrameRequestCallback>
let nextId=0
function Sample({balance=100,walletKey='a:1'}:{balance?:number;walletKey?:string}) { const m=useWalletMotion(walletKey,balance);return <output data-direction={m.direction}>{Math.round(m.amount??0)}</output> }
beforeEach(()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});reduced=false;callbacks=new Map();nextId=0
 vi.stubGlobal('matchMedia',()=>({matches:reduced,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++nextId,fn);return nextId})
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('animates a return once, survives StrictMode and does not replay on navigation',()=>{
 window.localStorage.setItem('pn:wallet-seen:v1:a:1','80')
 const first=render(<StrictMode><Sample/></StrictMode>)
 expect(first.container.querySelector('output')?.dataset.direction).toBe('gain')
 act(()=>{for(const fn of [...callbacks.values()]) fn(performance.now()+2000)})
 expect(first.container.textContent).toBe('100')
 first.unmount()
 const second=render(<Sample/>)
 expect(second.container.querySelector('output')?.dataset.direction).toBeUndefined()
})
it('skips movement for reduced motion and new accounts',()=>{
 reduced=true;window.localStorage.setItem('pn:wallet-seen:v1:a:1','80')
 const ui=render(<Sample/>)
 expect(ui.container.textContent).toBe('100')
 expect(ui.container.querySelector('output')?.dataset.direction).toBeUndefined()
 ui.rerender(<Sample walletKey="b:1" balance={200}/>)
 expect(ui.container.textContent).toBe('200')
})
it('handles decreases and cancels animation on unmount',()=>{
 window.localStorage.setItem('pn:wallet-seen:v1:a:1','120')
 const ui=render(<Sample/>)
 expect(ui.container.querySelector('output')?.dataset.direction).toBe('decrease')
 ui.unmount();expect(callbacks.size).toBe(0)
})

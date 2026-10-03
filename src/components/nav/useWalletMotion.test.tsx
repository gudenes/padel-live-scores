// @vitest-environment jsdom
import React from 'react'
import {act,cleanup,render,waitFor} from '@testing-library/react'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {useWalletMotion} from './useWalletMotion'
let callbacks:Map<number,FrameRequestCallback>,nextId=0,reduced=false
let request:ReturnType<typeof vi.fn>
function Sample({visible=true}:{visible?:boolean}){const m=useWalletMotion('a:1',100,visible);return <output data-direction={m.direction}>{Math.round(m.amount??0)}</output>}
beforeEach(()=>{
 Object.assign(globalThis,{React});callbacks=new Map();nextId=0;reduced=false
 vi.stubGlobal('matchMedia',()=>({matches:reduced}))
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++nextId,fn);return nextId})
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id))
 request=vi.fn(async(_url,options)=>Response.json(options?.method==='POST'?{acknowledged:true}:{change:{id:'change',from:80,to:100}}))
 vi.stubGlobal('fetch',request)
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('animates account history without a local-storage baseline, then acknowledges',async()=>{
 const ui=render(<Sample/>);await waitFor(()=>expect(ui.container.querySelector('output')?.dataset.direction).toBe('gain'))
 expect(request).toHaveBeenCalledTimes(1)
 await act(async()=>{for(const fn of [...callbacks.values()])fn(performance.now()+2000)})
 expect(request.mock.calls.some(([,options])=>options?.method==='POST')).toBe(true)
 expect(ui.container.textContent).toBe('100')
})
it('does not consume an unseen change when the wallet is hidden',async()=>{
 const ui=render(<Sample visible={false}/>);expect(request).not.toHaveBeenCalled()
 ui.rerender(<Sample/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(1))
 ui.unmount();expect(request.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false)
})
it('respects reduced motion and acknowledges after showing the current balance',async()=>{
 reduced=true;const ui=render(<Sample/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(2))
 expect(ui.container.querySelector('output')?.dataset.direction).toBeUndefined()
 expect(ui.container.textContent).toBe('100')
})
it('keeps the wallet usable when history is unavailable',async()=>{
 request.mockResolvedValue(Response.json({error:'history_unavailable'},{status:503}))
 const ui=render(<Sample/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(1))
 expect(ui.container.textContent).toBe('100')
})

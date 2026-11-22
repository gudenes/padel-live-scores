// @vitest-environment jsdom
import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {useApiResource} from './usePlayData'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('keeps a successful feed mounted during reload but never leaks it into a different URL',async()=>{
 let finish: (value: unknown)=>void = ()=>{}
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>['first']}).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 vi.stubGlobal('fetch',fetcher)
 const {result,rerender}=renderHook(({url})=>useApiResource(url, p=>p as string[],true,0,true),{initialProps:{url:'/markets'}})
 await waitFor(()=>expect(result.current.data).toEqual(['first']))
 act(()=>result.current.reload())
 expect(result.current.status).toBe('ready')
 expect(result.current.data).toEqual(['first'])
 await act(async()=>{finish({ok:true,json:async()=>['updated']})})
 await waitFor(()=>expect(result.current.data).toEqual(['updated']))
 rerender({url:'/other-market'})
 expect(result.current.status).toBe('loading')
 expect(result.current.data).toBeNull()
})

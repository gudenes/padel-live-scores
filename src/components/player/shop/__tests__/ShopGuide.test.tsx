// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
vi.mock('next-intl',()=>({useTranslations:()=> (key:string)=>key}))
vi.mock('@/components/SpotlightGuide',()=>({default:({eyebrow,onAdvance,onSkip,action,skipLabel}:any)=><div><p>{eyebrow}</p><button onClick={onAdvance}>{action}</button><button onClick={onSkip}>{skipLabel}</button></div>}))
import ShopGuide from '../ShopGuide'
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),clear:()=>values.clear()})})
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})
it('preview visits all three steps without saving completion',()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
 render(<ShopGuide ready paused={false} preview/>)
 expect(screen.getByText('label · 1/3')).toBeTruthy()
 fireEvent.click(screen.getByText('next'));expect(screen.getByText('label · 2/3')).toBeTruthy()
 fireEvent.click(screen.getByText('next'));expect(screen.getByText('label · 3/3')).toBeTruthy()
 fireEvent.click(screen.getByText('done'));expect(screen.queryByText('label · 3/3')).toBeNull()
 expect(fetcher).not.toHaveBeenCalled()
})
it('remembers skipping for the current user without affecting another user',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({seen:false})});vi.stubGlobal('fetch',fetcher)
 const {rerender}=render(<ShopGuide userId="one" ready paused={false}/>)
 await waitFor(()=>expect(screen.getByText('skip')).toBeTruthy())
 fireEvent.click(screen.getByText('skip'))
 expect(localStorage.getItem('pn:shop-guide:v1:one')).toBe('done')
 rerender(<ShopGuide userId="two" ready paused={false}/>)
 await waitFor(()=>expect(screen.getByText('label · 1/3')).toBeTruthy())
 expect(localStorage.getItem('pn:shop-guide:v1:two')).toBeNull()
})
it('does not start for an account that already completed the tour',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({seen:true})}))
 render(<ShopGuide userId="one" ready paused={false}/>)
 await waitFor(()=>expect(fetch).toHaveBeenCalled())
 expect(screen.queryByText('next')).toBeNull()
})

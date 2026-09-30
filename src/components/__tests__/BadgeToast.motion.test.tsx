// @vitest-environment jsdom
import React from 'react'
import {act,cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {BadgeToastProvider} from '../BadgeToast'
vi.mock('../AuthProvider',()=>({useAuth:()=>({user:{id:'invited'}})}))
vi.mock('@/app/[locale]/(app)/play/_components/usePlayData',()=>({useApiResource:()=>({data:true})}))
vi.mock('next-intl',()=>({useTranslations:()=>Object.assign((key:string)=>key,{has:()=>false})}))
vi.mock('../BadgeIcon',()=>({BadgeIcon:()=>null}))
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('React',React)})
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
function unlock(detail:unknown){act(()=>{window.dispatchEvent(new CustomEvent('pn-badge-unlock',{detail}))})}
it('shows a confirmed badge and removes it after its reading time',()=>{
 render(<BadgeToastProvider><p>App</p></BadgeToastProvider>)
 unlock({badge_id:'profile_complete',tier:1})
 expect(screen.getByText('unlocked')).toBeTruthy()
 act(()=>{vi.advanceTimersByTime(5500)})
 expect(screen.queryByText('unlocked')).toBe(null)
 expect(vi.getTimerCount()).toBe(0)
})
it('ignores invalid badge events',()=>{
 render(<BadgeToastProvider><p>App</p></BadgeToastProvider>)
 for(const detail of [undefined,{badge_id:'missing',tier:1},{badge_id:'profile_complete',tier:99}])unlock(detail)
 expect(screen.queryByText('unlocked')).toBe(null)
 expect(vi.getTimerCount()).toBe(0)
})
it('cleans up active timers when the provider unmounts',()=>{
 const view=render(<BadgeToastProvider><p>App</p></BadgeToastProvider>)
 unlock({badge_id:'profile_complete',tier:1})
 expect(vi.getTimerCount()).toBe(1)
 view.unmount()
 expect(vi.getTimerCount()).toBe(0)
})

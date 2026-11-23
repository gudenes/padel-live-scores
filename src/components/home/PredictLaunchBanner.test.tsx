// @vitest-environment jsdom
import React from 'react'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
vi.stubGlobal('React',React)
const state=vi.hoisted(()=>({consent:true,login:false}))
vi.mock('next-intl',()=>({useTranslations:()=> (key:string)=>key}))
vi.mock('next/image',()=>({default:()=>null}))
vi.mock('@/i18n/navigation',()=>({Link:({children,onClick}:{children:React.ReactNode;onClick:()=>void})=><button onClick={onClick}>{children}</button>}))
vi.mock('@/hooks/useConsent',()=>({useConsent:()=>({hasDecided:state.consent})}))
vi.mock('@/components/LoginSheetProvider',()=>({useLoginSheet:()=>({isOpen:state.login})}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}))
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
 Object.assign(state,{consent:true,login:false})
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
afterEach(()=>{cleanup();vi.useRealTimers()})
it.each(['dismiss','cta','escape'])('persists %s across a full component and module reload',async action=>{
 const {default:Banner,PREDICT_LAUNCH_DISMISSED_KEY:key}=await import('./PredictLaunchBanner')
 const view=render(<Banner/>);expect(screen.queryByRole('dialog')).toBeNull()
 act(()=>vi.advanceTimersByTime(1000));expect(screen.getByRole('dialog')).toBeTruthy()
 if(action==='escape')fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}))
 else fireEvent.click(screen.getByRole('button',{name:action==='cta'?/cta/:action}))
 expect(screen.queryByRole('dialog')).toBeNull();expect(localStorage.getItem(key)).toBe('1')
 view.unmount();vi.resetModules();const {default:Reloaded}=await import('./PredictLaunchBanner');render(<Reloaded/>);act(()=>vi.advanceTimersByTime(5000));expect(screen.queryByRole('dialog')).toBeNull()
})
it('waits for consent and avoids overlapping another dialog',async()=>{
 state.consent=false;const {default:Banner}=await import('./PredictLaunchBanner');const view=render(<Banner/>);act(()=>vi.advanceTimersByTime(5000));expect(screen.queryByRole('dialog')).toBeNull()
 const other=document.createElement('dialog');other.setAttribute('open','');document.body.append(other)
 state.consent=true;view.rerender(<Banner/>);act(()=>vi.advanceTimersByTime(2000));expect(screen.queryByText('PADEL PREDICT')).toBeNull()
 other.remove();act(()=>vi.advanceTimersByTime(1000));expect(screen.getByRole('dialog')).toBeTruthy()
})

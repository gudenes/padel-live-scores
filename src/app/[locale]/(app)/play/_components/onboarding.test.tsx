// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
vi.mock('@/i18n/navigation',()=>({Link:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}))
vi.mock('next-intl',()=>({useLocale:()=> 'en',useTranslations:()=> (key:string)=>key}))
vi.mock('@/components/player/shop/WardrobeFigure',()=>({Figure:({state}:{state:{avatar:string}})=><span>{state.avatar}</span>}))
vi.mock('@/components/GuacaCoin',()=>({default:()=> <span>Guacas</span>}))
import {IdentitySetup,OnboardingGuide} from './PlayOnboarding'
afterEach(cleanup)
it('lets the user choose a real roster face and save a trimmed name',async()=>{
 const save=vi.fn().mockResolvedValue(undefined)
 render(<IdentitySetup initial={{step:'identity',name:'',avatar:'face-06'}} onSave={save}/>)
 expect((screen.getByRole('button',{name:'start'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('publicName'),{target:{value:' Alex '}})
 fireEvent.click(screen.getByRole('button',{name:'Dara'}))
 fireEvent.click(screen.getByRole('button',{name:'start'}))
 await waitFor(()=>expect(save).toHaveBeenCalledWith('Alex','face-03'))
})
it('keeps identity editable and reports errors when saving fails',async()=>{
 render(<IdentitySetup initial={{step:'identity',name:'Alex',avatar:'face-06'}} onSave={async()=>{throw Error()}}/>)
 fireEvent.click(screen.getByRole('button',{name:'start'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('saveError'))
 expect((screen.getByLabelText('publicName') as HTMLInputElement).value).toBe('Alex')
})
it('does not strand users when there are no markets',()=>{
 const skip=vi.fn()
 render(<OnboardingGuide step="prediction" balance={1000} hasMarkets={false} trading={false} onAdvance={()=>{}} onSkip={skip} error={false}/>)
 expect(screen.getByRole('heading').textContent).toContain('emptyTitle')
 fireEvent.click(screen.getByRole('button',{name:'skip'}));expect(skip).toHaveBeenCalledOnce()
})
it('offers an exit instead of asking for an invisible question',()=>{
 render(<OnboardingGuide step="prediction" balance={1000} hasMarkets trading={false} onAdvance={()=>{}} onSkip={()=>{}} error={false}/>)
 expect(screen.getByRole('heading').textContent).toContain('emptyTitle')
})
it('finds editorial choices and constrains keyboard navigation to the guide',()=>{
 const rectangles=vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{x:10,y:250,width:250,height:80,top:250,bottom:330,left:10,right:260,toJSON:()=>({})}] as unknown as DOMRectList)
 const bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:250,width:250,height:80,top:250,bottom:330,left:10,right:260,toJSON:()=>({})})
 const skip=vi.fn()
 try{
 render(<><button>Background</button><div data-onboarding-choice="editorial"><button>Yes</button><button>No</button></div><OnboardingGuide step="prediction" balance={1000} hasMarkets trading={false} onAdvance={()=>{}} onSkip={skip} error={false}/></>)
 expect(screen.getByRole('heading').textContent).toContain('predictionTitle')
 fireEvent.keyDown(document,{key:'Tab'})
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'skip'}))
 fireEvent.keyDown(document,{key:'Tab'})
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Yes'}))
 fireEvent.keyDown(document,{key:'Escape'})
 expect(skip).toHaveBeenCalledOnce()
 }finally{rectangles.mockRestore();bounds.mockRestore()}
})

// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemberAvatar} from './MemberAvatar'
vi.mock('@/components/AuthProvider',()=>({useAuth:()=>({user:{id:'me'}})}))
vi.mock('./shop/AvatarShop',()=>({ShopProfileAvatar:()=> <span>Selected wardrobe portrait</span>,ShopProfileFigure:()=> <span>Selected wardrobe full body</span>}))
vi.mock('./shop/WardrobeFigure',()=>({Figure:({state}:{state:{avatar:string}})=><span>{state.avatar}</span>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('uses the same selected wardrobe as the header for own portrait and full body',()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({avatar:'saved-old',equipped:{}})}))
 const view=render(<MemberAvatar userId="me" fallback="Fallback"/>)
 expect(screen.getByText('Selected wardrobe portrait')).toBeTruthy()
 view.rerender(<MemberAvatar userId="me" full fallback="Fallback"/>)
 expect(screen.getByText('Selected wardrobe full body')).toBeTruthy()
})
it('keeps another member’s saved avatar rather than the viewer’s wardrobe',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({avatar:'other-player',equipped:{}})}))
 render(<MemberAvatar userId="other" fallback="Fallback"/>)
 expect(await screen.findByText('other-player')).toBeTruthy()
 expect(screen.queryByText('Selected wardrobe portrait')).toBeNull()
})

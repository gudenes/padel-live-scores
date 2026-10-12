// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
const mocks=vi.hoisted(()=>({path:'/scouting',palette:vi.fn(),adminNav:vi.fn()}))
vi.mock('next/link',()=>({default:({children,...props}:any)=>createElement('a',props,children)}))
vi.mock('next/navigation',()=>({usePathname:()=>mocks.path}))
vi.mock('../actions/sign-out',()=>({signOutAction:vi.fn()}))
vi.mock('../../components/shell/HorizontalNav',()=>({HorizontalNav:()=>{mocks.adminNav();return null}}))
vi.mock('../../components/shell/CommandPalette',()=>({CommandPalette:()=>{mocks.palette();return null}}))
import {GlobalHeader} from '../../components/shell/GlobalHeader'
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.path='/scouting'})
it('shares brand, download, theme and account controls without mounting administrator navigation or search',()=>{
 render(createElement(GlobalHeader,{scoped:true,userEmail:'scouter@example.com'}))
 expect(screen.getByAltText('Padel Nachos')).toBeTruthy()
 expect(screen.getByAltText('Padel Labs')).toBeTruthy()
 expect(screen.getByRole('link',{name:'Padel Nachos and Padel Labs · Matches'}).getAttribute('href')).toBe('/scouting')
 expect(screen.getByRole('link',{name:'Download scouting extension'}).getAttribute('href')).toContain('0.2.8.zip')
 expect(screen.getByRole('button',{name:'Toggle theme'})).toBeTruthy()
 expect(screen.getByRole('link',{name:'Matches'}).getAttribute('aria-current')).toBe('page')
 expect(screen.queryByLabelText('Search admin')).toBeNull()
 expect(mocks.palette).not.toHaveBeenCalled()
 expect(mocks.adminNav).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Open account menu'}))
 expect(screen.getByText('scouter@example.com')).toBeTruthy()
 expect(screen.getByRole('menuitem',{name:'Sign out'}).getAttribute('href')).toBe('/api/auth/signout')
})
it('highlights methodology independently and preserves the administrator shell',()=>{
 mocks.path='/scouting/methodology'
 const result=render(createElement(GlobalHeader,{scoped:true}))
 expect(screen.getByRole('link',{name:'Methodology'}).getAttribute('aria-current')).toBe('page')
 result.rerender(createElement(GlobalHeader))
 expect(screen.getByLabelText('Search admin')).toBeTruthy()
 expect(mocks.adminNav).toHaveBeenCalled()
 expect(mocks.palette).toHaveBeenCalled()
})

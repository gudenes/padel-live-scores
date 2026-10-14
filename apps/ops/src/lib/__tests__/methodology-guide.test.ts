// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react'
import MethodologyGuide,{MethodologyContent} from '@/components/scouting/MethodologyGuide'
vi.mock('next/link',()=>({default:({children,...props}:any)=>createElement('a',props,children)}))
afterEach(cleanup)
it('explains weighted actions using the selected version, including negative pressure',()=>{
 const view=render(createElement(MethodologyContent))
 const actions=screen.getByLabelText('Example action'),pressure=screen.getByLabelText('Example pressure')
 fireEvent.click(within(actions).getByRole('button',{name:'Assist'}))
 fireEvent.click(within(pressure).getByRole('button',{name:'Match point'}))
 expect(view.container.querySelector('[aria-live=polite]')?.textContent).toContain('+1.25')
 fireEvent.click(within(actions).getByRole('button',{name:'Unforced error'}))
 expect(view.container.querySelector('[aria-live=polite]')?.textContent).toContain('−2.5'.replace('−','-'))
 view.rerender(createElement(MethodologyContent,{methodology:'net-actions'}))
 expect(view.container.querySelector('[aria-live=polite]')?.textContent).toContain('-1')
 fireEvent.click(within(actions).getByRole('button',{name:'Assist'}))
 expect(view.container.querySelector('[aria-live=polite]')?.textContent).toContain('0 × 1')
})
it('opens a labelled guide, changes topic and closes without navigating',()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 render(createElement(MethodologyGuide))
 fireEvent.click(screen.getByRole('button',{name:'Methodology'}))
 const dialog=screen.getByRole('dialog',{name:'Behind the numbers.'})
 fireEvent.click(within(dialog).getByRole('button',{name:'Assists & shots'}))
 expect(within(dialog).getByText('Teammate’s shot')).toBeTruthy()
 expect(within(dialog).getByText(/These must be the final three/)).toBeTruthy()
 fireEvent.click(within(dialog).getByRole('button',{name:'Close methodology'}))
 expect(screen.queryByRole('dialog')).toBeNull()
})

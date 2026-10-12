// @vitest-environment jsdom
import {createElement} from 'react'
import {render,fireEvent,act,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import CatalogSearchForm from '../../app/(scouting)/scouting/CatalogSearchForm'
const {replace}=vi.hoisted(()=>({replace:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({replace})}))
afterEach(()=>{cleanup();vi.useRealTimers();replace.mockClear()})
it('waits for three letters, debounces, preserves filters and searches again when cleared',async()=>{
 vi.useFakeTimers()
 const view=render(createElement(CatalogSearchForm,{className:'filters',children:[createElement('input',{key:'q',name:'q','aria-label':'Search'}),createElement('input',{key:'s',type:'hidden',name:'scouting',value:'scouted'})]}))
 const input=view.getByLabelText('Search')
 fireEvent.change(input,{target:{value:'sa'}})
 await act(()=>vi.advanceTimersByTimeAsync(450));expect(replace).not.toHaveBeenCalled()
 fireEvent.change(input,{target:{value:'san'}});fireEvent.change(input,{target:{value:'sanz'}})
 await act(()=>vi.advanceTimersByTimeAsync(450));expect(replace).toHaveBeenCalledTimes(1)
 expect(replace).toHaveBeenLastCalledWith('/scouting?q=sanz&scouting=scouted',{scroll:false})
 fireEvent.change(input,{target:{value:''}});await act(()=>vi.advanceTimersByTimeAsync(450))
 expect(replace).toHaveBeenLastCalledWith('/scouting?scouting=scouted',{scroll:false})
})

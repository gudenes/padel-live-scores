// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import FilterSelect from '../../app/(scouting)/scouting/FilterSelect'
import FilterDate from '../../app/(scouting)/scouting/FilterDate'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('searches custom options and submits the selected value from the keyboard',()=>{
 let selected:FormData|undefined
 vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(function(this:HTMLFormElement){selected=new FormData(this)})
 render(createElement('form',{},createElement(FilterSelect,{name:'league',label:'Tier',value:'',options:[{value:'',label:'All'},{value:'p2',label:'P2',group:'Premier Padel'},{value:'fip_gold',label:'Gold',group:'FIP'}]})))
 fireEvent.click(screen.getByRole('button',{name:'Tier All'}))
 const search=screen.getByRole('combobox')
 fireEvent.change(search,{target:{value:'Gold'}});expect(screen.queryByRole('option',{name:'P2'})).toBeNull()
 fireEvent.keyDown(search,{key:'Enter'})
 expect(selected?.get('league')).toBe('fip_gold');expect(screen.queryByRole('listbox')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Tier Gold'}));fireEvent.keyDown(screen.getByRole('combobox'),{key:'Escape'})
 expect(screen.queryByRole('listbox')).toBeNull()
})
it('submits an exact calendar date without timezone conversion',()=>{
 let selected:FormData|undefined
 vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(function(this:HTMLFormElement){selected=new FormData(this)})
 render(createElement('form',{},createElement(FilterDate,{value:'2026-10-12'})))
 fireEvent.click(screen.getByRole('button',{name:'Match date'}));fireEvent.click(screen.getByRole('button',{name:'2026-10-15'}))
 expect(selected?.get('date')).toBe('2026-10-15');expect(screen.queryByRole('dialog')).toBeNull()
})

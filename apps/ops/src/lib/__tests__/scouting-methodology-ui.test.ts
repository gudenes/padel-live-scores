// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect} from 'vitest'
import {cleanup,render,screen,fireEvent} from '@testing-library/react'
import Insights from '../../app/(app)/scouting/[id]/Insights'
import {freshDoc,replay,type Event} from '../scouting/model'

afterEach(cleanup)
const players=['A1','A2','B1','B2'].map((name,i)=>({id:String(i),name}))
const doc={...freshDoc(),events:[
 {id:'one',at:'2026-10-07T10:00:00Z',kind:'point',player:0,outcome:'winner',smash:false},
 {id:'two',at:'2026-10-07T10:00:01Z',kind:'point',player:2,outcome:'forced',forcedBy:1,smash:false},
] as Event[]}

it('defaults to v0.3 and switches graphs and derived scores without changing raw winners',()=>{
 render(createElement(Insights,{model:replay(doc),doc,players}))
 const select=screen.getByRole('combobox',{name:'Methodology'}) as HTMLSelectElement
 expect(select.value).toBe('v0.3')
 expect(screen.getAllByRole('img',{name:/Player Score/})).toHaveLength(4)
 expect(screen.getByRole('img',{name:/Four-player evolution · v0.3/})).toBeTruthy()
 fireEvent.change(select,{target:{value:'net-actions'}})
 expect(screen.queryAllByRole('img',{name:/Player Score/})).toHaveLength(0)
 expect(screen.getByRole('img',{name:/Four-player evolution · Original/})).toBeTruthy()
 expect(screen.getAllByText('Winners')).toHaveLength(5)
 fireEvent.change(select,{target:{value:'v0.2'}})
 expect(screen.getAllByRole('img',{name:/Player Score/})).toHaveLength(4)
 fireEvent.change(screen.getByRole('slider',{name:'Explore match point'}),{target:{value:'1'}})
 expect(screen.getByText('Player stats · through point 1')).toBeTruthy()
})

it('displays no scores before the first point and warns about missing attribution',()=>{
 const view=render(createElement(Insights,{model:replay(freshDoc()),doc:freshDoc(),players}))
 expect(screen.getAllByRole('img',{name:'Player Score not available'})).toHaveLength(4)
 const missing={...freshDoc(),events:[{id:'missing',at:'2026-10-07T10:00:00Z',kind:'point',player:0,outcome:'forced',smash:false} as Event]}
 view.rerender(createElement(Insights,{model:replay(missing),doc:missing,players}))
 expect(screen.getByRole('status').textContent).toContain('0/1')
})

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

it('defaults to v1.3 and switches graphs and derived scores without changing raw winners',()=>{
 render(createElement(Insights,{model:replay(doc),doc,players}))
 const select=screen.getByRole('combobox',{name:'Methodology'}) as HTMLSelectElement
 expect(select.value).toBe('v1.3')
 expect(screen.getAllByRole('img',{name:/Player Score/})).toHaveLength(4)
 expect(screen.getByRole('img',{name:/Four-player evolution · v1.3/})).toBeTruthy()
 fireEvent.change(select,{target:{value:'net-actions'}})
 expect(screen.queryAllByRole('img',{name:/Player Score/})).toHaveLength(0)
 expect(screen.getByRole('img',{name:/Four-player evolution · Original/})).toBeTruthy()
 expect(screen.getAllByText('Winners')).toHaveLength(6)
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

it('filters the chart, team summary and player snapshots by set and restores full-match totals',()=>{
 const seed={id:'seed',at:'2026-10-07T10:00:00Z',kind:'score',seed:{sets:[{a:5,b:2}],game:{a:40,b:0},phase:'playing',returns:0,server:0}} as Event
 const setDoc={...doc,events:[seed,...doc.events]}
 const {container}=render(createElement(Insights,{model:replay(setDoc),doc:setDoc,players}))
 expect(screen.getByRole('heading',{name:'Team summary · Full match'})).toBeTruthy()
 expect(container.querySelectorAll('path[stroke="var(--lime-text)"]')).toHaveLength(2)
 const keys=container.querySelectorAll('[class*="lineKey"]')
 expect((keys[0] as HTMLElement).style.borderTopStyle).toBe('solid')
 expect((keys[1] as HTMLElement).style.borderTopStyle).toBe('dotted')
 fireEvent.click(screen.getByRole('button',{name:'Set 2'}))
 expect(screen.getByRole('heading',{name:'Team summary · Set 2'})).toBeTruthy()
 expect(screen.getByText(/Set 2 · 1 observed points/)).toBeTruthy()
 expect(screen.getByRole('slider',{name:'Explore match point'}).getAttribute('max')).toBe('1')
 const summary=screen.getByRole('region',{name:'Team summary'})
 expect(summary.querySelector('tbody tr')?.textContent).toBe('Winners00')
 fireEvent.click(screen.getByRole('button',{name:'Full match'}))
 expect(summary.querySelector('tbody tr')?.textContent).toBe('Winners10')
 expect(screen.getByRole('slider',{name:'Explore match point'}).getAttribute('max')).toBe('2')
})

it('recalculates assisted winner scores when switching to the preserved v0.3 method',()=>{
 const assisted={...freshDoc(),events:[{id:'assist',at:'2026-10-07T10:00:00Z',kind:'point',player:0,outcome:'winner',assistBy:1,smash:false} as Event]}
 render(createElement(Insights,{model:replay(assisted),doc:assisted,players}))
 expect(screen.getAllByRole('img',{name:'Player Score 10.0 out of 10'})).toHaveLength(2)
 expect(screen.getByText(/Assisted winners split impact equally/)).toBeTruthy()
 fireEvent.change(screen.getByRole('combobox',{name:'Methodology'}),{target:{value:'v0.3'}})
 expect(screen.getAllByRole('img',{name:'Player Score 10.0 out of 10'})).toHaveLength(1)
 expect(screen.getByRole('img',{name:'Player Score 7.3 out of 10'})).toBeTruthy()
 expect(screen.getByText(/Assists are recorded without separate impact credit/)).toBeTruthy()
})

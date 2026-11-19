import {describe,it,expect} from 'vitest'
import {defaultSearch,readSavedView,savedViewChanges,sameSearch,serializeRules} from '../saved-player-views'
describe('saved player searches',()=>{
  it('keeps legacy rule-only views and assigns original default filters',()=>{
    const view=readSavedView({id:'cat',name:'Catalunya players',match:'all',rules:[{field:'birth_region',operator:'is',value:'ES:09'}]})
    expect(view.search).toEqual(defaultSearch)
    expect(savedViewChanges(view).rules).toContain('ES:09')
  })
  it('restores every saved filter and resets pagination',()=>{
    const search={q:'Sanchez',gender:'women',year:'2026',sort:'rank',filter:'scouted'}
    const view=readSavedView({id:'search',name:'Scouted women',match:'all',rules:[],search})
    expect(savedViewChanges(view)).toEqual({...search,rules:null,savedView:'search',page:null})
  })
  it('supports a saved search without extra rules',()=>{
    const view=readSavedView({id:'search',name:'All women',rules:[],search:{gender:'women'}})
    expect(serializeRules(view)).toBe('')
    expect(view.search.gender).toBe('women')
    expect(view.search.filter).toBe('all')
  })
  it('detects changed search, category, period, sorting and list filters',()=>{
    expect(sameSearch({...defaultSearch},defaultSearch)).toBe(true)
    for(const key of Object.keys(defaultSearch)) expect(sameSearch({...defaultSearch,[key]:'different'},defaultSearch)).toBe(false)
  })
  it('rejects corrupt saved filters instead of applying them',()=>{
    expect(()=>readSavedView({id:'bad',name:'Bad',rules:[],search:{filter:'hidden'}})).toThrow()
    expect(()=>readSavedView({id:'bad',name:'Bad',rules:[{field:'birth_region',operator:'is',value:'invalid'}]})).toThrow()
  })
})

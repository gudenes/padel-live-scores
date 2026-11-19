import {describe, expect, it} from 'vitest'
import {matchesPlayerRules, parsePlayerRules} from '../player-views'
import type {Person} from '../model'
const player: Person = {id: '1', name: 'Player', country: 'ES', category: 'women', ranking: 20, birthplace: 'Sant Cugat del Vallès, Barcelona', avatar_url: null}
const rules = (value: unknown) => parsePlayerRules(JSON.stringify(value))
describe('dynamic player views', () => {
  it('matches accents and case, without treating nationality as birthplace', () => {
    const view = rules({match: 'all', rules: [{field: 'birthplace', operator: 'any', value: 'Catalunya, BARCELONA, Girona'}]})
    expect(matchesPlayerRules(player, view)).toBe(true)
    expect(matchesPlayerRules({...player, birthplace: 'Madrid'}, view)).toBe(false)
    expect(matchesPlayerRules({...player, birthplace: null}, view)).toBe(false)
    expect(matchesPlayerRules(player, rules({match: 'all', rules: [{field: 'birthplace', operator: 'contains', value: 'valles'}]}))).toBe(true)
  })
  it('combines all/any with inclusive ranking comparisons', () => {
    const view = rules({match: 'all', rules: [{field: 'ranking', operator: 'lte', value: '20'}, {field: 'category', operator: 'is', value: 'men'}]})
    expect(matchesPlayerRules(player, view)).toBe(false)
    expect(matchesPlayerRules(player, {...view, match: 'any'})).toBe(true)
    expect(matchesPlayerRules({...player, ranking: null}, {...view, match: 'any'})).toBe(false)
    expect(matchesPlayerRules({...player, category: 'men'}, view)).toBe(true)
  })
  it('lets users explicitly find missing data', () => {
    const view = rules({match: 'all', rules: [{field: 'birthplace', operator: 'missing', value: ''}]})
    expect(matchesPlayerRules({...player, birthplace: ' '}, view)).toBe(true)
    expect(matchesPlayerRules(player, view)).toBe(false)
  })
  it.each([
    null, {match: 'all', rules: []},
    {match: 'all', rules: [{field: '__proto__', operator: 'is', value: 'x'}]},
    {match: 'all', rules: [{field: 'country', operator: 'lte', value: 'ES'}]},
    {match: 'all', rules: [{field: 'ranking', operator: 'lte', value: '-1'}]},
    {match: 'all', rules: [{field: 'birthplace', operator: 'any', value: ', ,'}]},
    {match: 'all', rules: [{field: 'birthplace', operator: 'contains', value: ''}]},
  ])('rejects malformed rules: %j', input => { expect(() => rules(input)).toThrow() })
})

describe('normalized birthplace rules', () => {
  const region = rules({match:'all',rules:[{field:'birth_region',operator:'is',value:'ES:09'}]})
  it('matches the stored region for every mapped municipality, irrespective of nationality', () => {
    expect(matchesPlayerRules({...player,country:'AE',birthplace:'Vic',birth_region:'ES:09',birth_status:'proposed'},region)).toBe(true)
    expect(matchesPlayerRules({...player,birth_region:null,birth_status:'missing'},region)).toBe(false)
    expect(matchesPlayerRules({...player,birth_region:'ES:13',birth_status:'proposed'},region)).toBe(false)
  })
  it('can require a verified mapping without treating proposals as verified', () => {
    const verified=rules({match:'all',rules:[...region.rules,{field:'birth_status',operator:'is',value:'verified'}]})
    expect(matchesPlayerRules({...player,birth_region:'ES:09',birth_status:'proposed'},verified)).toBe(false)
    expect(matchesPlayerRules({...player,birth_region:'ES:09',birth_status:'verified'},verified)).toBe(true)
  })
  it('rejects unknown region/status values and text operators for normalized fields', () => {
    for(const rule of [{field:'birth_region',operator:'is',value:'Catalunya'},{field:'birth_status',operator:'is',value:'guessed'},{field:'birth_region',operator:'contains',value:'ES:09'}]) expect(()=>rules({match:'all',rules:[rule]})).toThrow()
  })
})

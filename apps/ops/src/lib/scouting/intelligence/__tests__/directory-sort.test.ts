import {describe,it,expect} from 'vitest'
import {parseDirectorySort,compareValues,directorySortValue,validDirectorySort} from '../directory-sort'
import {readSavedView,savedViewChanges} from '../saved-player-views'
import type {Person,Summary} from '../model'
describe('directory sorting',()=>{
 it('preserves legacy defaults and supports reverse direction',()=>{
 expect(parseDirectorySort('rank')).toEqual({key:'rank',direction:'asc'})
 expect(parseDirectorySort('impact')).toEqual({key:'impact',direction:'desc'})
 expect(parseDirectorySort('rank:desc')).toEqual({key:'rank',direction:'desc'})
 expect(validDirectorySort('constructor')).toBe(false)
 expect(validDirectorySort('rank:bad')).toBe(false)
 })
 it.each(['asc','desc'])('keeps missing values last when %s',direction=>{
 expect([null,3,1,2].sort((a,b)=>compareValues(a,b,direction))).toEqual(direction==='asc'?[1,2,3,null]:[3,2,1,null])
 })
 it('sorts rates by denominator and preserves recorded zero',()=>{
 const s={points:100,winners:0,matches:2,impact:6,wins:1,losses:1,smashes:0} as Summary
 expect(directorySortValue('winners',[],s,0,[])).toBe(0)
 expect(directorySortValue('smash',[],s,0,[])).toBeNull()
 expect(directorySortValue('record',[],s,0,[])).toBe(.5)
 expect(directorySortValue('rank',[{ranking:null}] as Person[],s,0,[])).toBeNull()
 })
 it('restores gender season and descending column sorting in saved views',()=>{
 const view=readSavedView({id:'test',name:'Catalunya women',match:'all',rules:[],search:{gender:'women',year:'2026',sort:'rank:desc'}})
 expect(savedViewChanges(view)).toMatchObject({gender:'women',year:'2026',sort:'rank:desc',page:null})
 })
})

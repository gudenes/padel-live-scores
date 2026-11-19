import {describe,it,expect} from 'vitest'
import {currentSeason,seasonParams} from '../season'
import {readSavedView,savedViewChanges} from '../saved-player-views'
describe('default season',()=>{
 it('uses the Madrid calendar year at rollover',()=>{
 expect(currentSeason(new Date('2026-12-31T23:30:00Z'))).toBe('2027')
 })
 it('defaults only absent seasons and preserves explicit all seasons',()=>{
 expect(seasonParams(new URLSearchParams()).get('year')).toBe(currentSeason())
 expect(seasonParams(new URLSearchParams('year=')).get('year')).toBe('')
 expect(seasonParams(new URLSearchParams('year=2024')).get('year')).toBe('2024')
 })
 it('preserves a saved all-season view',()=>{
 const view=readSavedView({id:'all',name:'All years',rules:[],search:{year:''}})
 expect(savedViewChanges(view).year).toBe('')
 })
})

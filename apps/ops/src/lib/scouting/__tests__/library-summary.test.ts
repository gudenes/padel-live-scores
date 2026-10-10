import {describe,it,expect} from 'vitest'
import {librarySummary,libraryDuration} from '../library-summary'
import {freshDoc} from '../model'
import {savedReport} from '../saved-report'
import {methodologyAnalysis} from '../methodology'
const row={document:freshDoc(),players:[0,1,2,3].map(i=>({id:String(i),name:`Player ${i}`})),revision:1,updated_at:'2026-10-10T00:00:00Z'}
describe('match library',()=>{
 it('uses report methodology without manufacturing ratings for an empty observation',()=>{const result=librarySummary(row,'admin');expect(result.ratings).toEqual(methodologyAnalysis(savedReport(row,'admin').model.tracking.timeline).players.map(p=>p.score));expect(result.ratings).toEqual([null,null,null,null]);expect(result.failed).toBe(false)})
 it('isolates malformed reports so other cards remain usable',()=>{expect(librarySummary({...row,document:{}},'video')).toMatchObject({failed:true,points:null,ratings:[null,null,null,null]})})
 it('does not confuse unavailable duration with zero or accept malformed times',()=>{expect(libraryDuration('01:42')).toBe('1h 42m');expect(libraryDuration('00:48')).toBe('48m');for(const v of [null,'','00:00','01:75','05:00',102])expect(libraryDuration(v)).toBeNull()})
})

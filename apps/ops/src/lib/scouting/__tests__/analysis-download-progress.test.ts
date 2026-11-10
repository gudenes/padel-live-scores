import {describe,it,expect} from 'vitest'
import {analysisProgress} from '../analysis-progress'
describe('download progress',()=>{
 it('shows measured bytes as stage progress',()=>{expect(analysisProgress({status:'running',stage:'downloading',progress:{processed:1800000000,total:4340000000}})).toMatchObject({percent:41,label:'Downloading video',index:0})})
 it('keeps start-only preparation indeterminate',()=>{expect(analysisProgress({status:'running',stage:'normalizing',progress:{processed:0,total:4864}}).percent).toBeNull()})
 it('does not report a percent without a valid total',()=>{expect(analysisProgress({status:'running',stage:'downloading',progress:{processed:100,total:0}}).percent).toBeNull()})
})

import {describe,it,expect} from 'vitest'
import {validateJobSetup,jobBody} from '../../lab-vision-jobs'
const video={file_name:'match.mp4',byte_size:100,duration_seconds:100}
const setup:any={version:1,confirmed:true,file:{name:'match.mp4',size:100},duration:100,matchStart:5,calibrationTime:8,offset:0,recording:'broadcast',points:[{x:.2,y:.2},{x:.8,y:.2},{x:.9,y:.9},{x:.1,y:.9},{x:.15,y:.5},{x:.85,y:.5},...Array(4).fill({x:.4,y:.4})],identities:['a','b','c','d'],playerNames:['a','b','c','d']}
describe('analysis queue input',()=>{
 it('accepts confirmed frame and fixed-camera recording',()=>{expect(validateJobSetup({...setup,recording:'fixed'},video)).toBeTruthy()})
 it('rejects calibration for a different uploaded file',()=>{expect(()=>validateJobSetup({...setup,file:{name:'other.mp4',size:100}},video)).toThrow('different video')})
 it('rejects unconfirmed, missing, crossed and duplicate markers',()=>{
  for(const change of [{confirmed:false},{points:[...setup.points.slice(0,9),null]},{points:[setup.points[0],setup.points[2],setup.points[1],...setup.points.slice(3)]},{identities:['a','a','c','d']}])expect(()=>validateJobSetup({...setup,...change},video)).toThrow()
 })
 it('rejects times outside source and non-finite values',()=>{for(const change of [{matchStart:100},{calibrationTime:-1},{duration:150},{offset:Infinity}])expect(()=>validateJobSetup({...setup,...change},video)).toThrow()})
 it('bounds streamed JSON before parsing',async()=>{await expect(jobBody(new Request('http://localhost',{method:'POST',body:'x'.repeat(100)}),30)).rejects.toThrow('large')})
})

import {describe,it,expect} from 'vitest'
import {parseVideoUpload} from '../match-video'
import {scoutToVideo} from '../scouting-alignment'
import {validateJobSetup,jobBody} from '../../lab-vision-jobs'
const video={file_name:'match.mp4',byte_size:100,duration_seconds:100}
const setup:any={version:1,confirmed:true,file:{name:'match.mp4',size:100},duration:100,matchStart:5,calibrationTime:8,offset:0,recording:'broadcast',points:[{x:.2,y:.2},{x:.8,y:.2},{x:.9,y:.9},{x:.1,y:.9},{x:.15,y:.5},{x:.85,y:.5},...Array(4).fill({x:.4,y:.4})],identities:['a','b','c','d'],playerNames:['a','b','c','d']}
describe('analysis queue input',()=>{
 it('passes a live-clock upload into analysis without changing saved court or player setup',()=>{
  const sourceTime=1794576362.787712,videoTime=118.35471200942993;
  const saved={...setup,duration:6684,matchStart:videoTime,calibrationTime:130,offset:sourceTime-videoTime,scoutingAnchor:{rallyId:'0d51eb3d-bef5-4127-b907-efba35267138',sourceTime,videoTime}};
  const before=structuredClone(saved);
  const upload=parseVideoUpload({id:'386b5bd2-9dca-4bae-ba32-5482ba0dbdbd',name:saved.file.name,size:saved.file.size,duration:saved.duration,offset:saved.offset});
  const accepted=validateJobSetup(saved,{file_name:upload.name,byte_size:upload.size,duration_seconds:upload.duration});
  expect(accepted).toEqual(saved);
  expect(saved).toEqual(before);
  expect(scoutToVideo(sourceTime,upload.offset)).toBeCloseTo(videoTime,5);
 })
 it('accepts confirmed frame and fixed-camera recording',()=>{expect(validateJobSetup({...setup,recording:'fixed'},video)).toBeTruthy()})
 it('maps wizard roster indices to names without losing the selected court order',()=>{
  const indexed={...setup,identities:['2','3','1','0']};
  expect(validateJobSetup(indexed,video).identities).toEqual(['c','d','b','a']);
  expect(indexed.identities).toEqual(['2','3','1','0']);
 })
 it('preserves named legacy setups in their court order',()=>{expect(validateJobSetup({...setup,identities:['d','b','c','a']},video).identities).toEqual(['d','b','c','a'])})
 it('rejects incomplete, mixed, duplicate and invalid indexed identities',()=>{
  for(const identities of [['0','1','2',''],['0','1','2','4'],['0','0','2','3'],['a','1','2','3'],[0,1,2,3]])expect(()=>validateJobSetup({...setup,identities},video)).toThrow('four different');
 })
 it('rejects calibration for a different uploaded file',()=>{expect(()=>validateJobSetup({...setup,file:{name:'other.mp4',size:100}},video)).toThrow('different video')})
 it('rejects unconfirmed, missing, crossed and duplicate markers',()=>{
  for(const change of [{confirmed:false},{points:[...setup.points.slice(0,9),null]},{points:[setup.points[0],setup.points[2],setup.points[1],...setup.points.slice(3)]},{identities:['a','a','c','d']}])expect(()=>validateJobSetup({...setup,...change},video)).toThrow()
 })
 it('rejects times outside source and non-finite values',()=>{for(const change of [{matchStart:100},{calibrationTime:-1},{duration:150},{offset:Infinity}])expect(()=>validateJobSetup({...setup,...change},video)).toThrow()})
 it('bounds streamed JSON before parsing',async()=>{await expect(jobBody(new Request('http://localhost',{method:'POST',body:'x'.repeat(100)}),30)).rejects.toThrow('large')})
})

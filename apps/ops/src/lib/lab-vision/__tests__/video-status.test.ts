import {describe,it,expect} from 'vitest'
import {labelProgress,videoStatus,videoTitle,type VideoRun} from '../video-status'
const valid={id:'a',kind:'Shot contact',status:'verified',shot:'Serve',confirmed:true,player:'Player',box:{x:0,y:0,width:.2,height:.4},time:5,start:4,end:6,duration:20}
const run=(labels=labelProgress([]),status='complete'):VideoRun=>({id:'run',video_id:'video',match_id:'match',file_name:'video.mp4',updated_at:'2026-11-16',status,stage:'players',labels})
describe('video status',()=>{
 it('does not call an empty or all-excluded run ready',()=>{
  expect(videoStatus(run()).review).toBe('Not started')
  expect(videoStatus(run(labelProgress([{...valid,status:'excluded'}]))).filter).toBe('review')
 })
 it('distinguishes approved labels from training eligibility',()=>{
  const counts=labelProgress([{...valid,box:null}])
  expect(counts).toEqual({total:1,reviewed:1,eligible:0,pending:1})
  expect(videoStatus(run(counts)).review).toBe('Needs review')
 })
 it('uses latest revisions, excludes rejections and ignores non-shot annotations',()=>{
  const counts=labelProgress([valid,{...valid,id:'b',supersedes:'a',box:null},{...valid,id:'c',status:'excluded'},{...valid,id:'d',kind:'Player tracking issue'}])
  expect(counts).toEqual({total:2,reviewed:2,eligible:0,pending:1})
 })
 it('requires every non-rejected saved shot to pass the shared eligibility policy',()=>{
  expect(videoStatus(run(labelProgress([valid,{...valid,id:'b',status:'needs_review',confirmed:false}]))).filter).toBe('review')
  expect(videoStatus(run(labelProgress([valid,{...valid,id:'b',status:'excluded'}]))).filter).toBe('ready')
 })
 it('keeps active, failed and cancelled analyses separate from ready labels',()=>{
  const labels=labelProgress([valid])
  expect(videoStatus({...run(labels,'running'),progress:{processed:64,total:100}})).toMatchObject({filter:'processing',analysis:'Tracking players · 64%',tab:'Workflow'})
  expect(videoStatus(run(labels,'failed')).filter).toBe('failed')
  expect(videoStatus(run(labels,'cancelled')).analysis).toBe('Analysis stopped')
 })
 it('uses known players and otherwise preserves the filename',()=>{
  expect(videoTitle(run())).toBe('video.mp4')
  expect(videoTitle({...run(),setup:{playerNames:['A','B','C','D']}})).toBe('A / B vs C / D')
 })
})

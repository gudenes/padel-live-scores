import {describe,it,expect} from 'vitest'
import {matchVideoStatus,parseVideoStatusMatches,stagePercent,videoStatusLabel} from '../video-status'
const id='386b5bd2-9dca-4bae-ba32-5482ba0dbdbd'
describe('match video badges',()=>{
 it('keeps ready analysis accessible during a rerun',()=>{expect(matchVideoStatus(true,true)).toBe('ready')})
 it('shows processing only for active jobs and hides unavailable results',()=>{expect(matchVideoStatus(false,true)).toBe('processing');expect(matchVideoStatus(false,false)).toBeNull();expect(matchVideoStatus(true,false)).toBe('ready')})
 it('keeps manual and official matches separate and deduplicates requests',()=>{expect(parseVideoStatusMatches(`canonical:${id},manual:${id},canonical:${id}`)).toEqual([{kind:'canonical',id},{kind:'manual',id}])})
 it('rejects malformed identifiers and oversized requests',()=>{expect(()=>parseVideoStatusMatches('canonical:bad')).toThrow();expect(()=>parseVideoStatusMatches(`other:${id}`)).toThrow();expect(()=>parseVideoStatusMatches(Array.from({length:201},(_,i)=>`canonical:${String(i).padStart(8,'0')}-9dca-4bae-ba32-5482ba0dbdbd`).join(','))).toThrow()})
})

describe('queue progress',()=>{
 it('does not invent a percentage without valid stage totals',()=>{expect(stagePercent(null)).toBeUndefined();expect(stagePercent({processed:2,total:0})).toBeUndefined();expect(stagePercent({processed:NaN,total:10})).toBeUndefined()})
 it('clamps stage progress and labels waiting positions separately',()=>{expect(stagePercent({processed:42,total:100})).toBe(42);expect(stagePercent({processed:120,total:100})).toBe(100);expect(videoStatusLabel({state:'queued',position:2})).toBe('Queued · #2');expect(videoStatusLabel({state:'processing',percent:42})).toBe('Processing · 42%')})
})

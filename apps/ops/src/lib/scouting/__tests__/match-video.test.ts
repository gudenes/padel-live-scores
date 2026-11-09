import {describe,it,expect} from 'vitest'
import {parseVideoUpload,VIDEO_PART_SIZE,expectedPartSize,validateParts} from '../match-video'
const valid={id:'53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa',name:'match.mp4',size:VIDEO_PART_SIZE+10,offset:18881,duration:7480}
describe('private match uploads',()=>{
 it('keeps timing and determines a safe content type',()=>expect(parseVideoUpload(valid).type).toBe('video/mp4'))
 it('rejects non-video files, excessive sizes, and invalid timing',()=>{for(const patch of [{name:'file.html'},{size:21*1024**3},{offset:-1},{duration:NaN},{id:'../other'}])expect(()=>parseVideoUpload({...valid,...patch})).toThrow()})
 it('bounds each signed part to the declared file',()=>{expect(expectedPartSize(valid.size,2)).toBe(10);for(const n of [0,3,1.5])expect(()=>expectedPartSize(valid.size,n)).toThrow()})
 it('requires the exact complete file before attaching it',()=>{const parts=[{PartNumber:1,Size:VIDEO_PART_SIZE,ETag:'a'},{PartNumber:2,Size:10,ETag:'b'}];expect(validateParts(valid.size,parts).length).toBe(2);expect(()=>validateParts(valid.size,parts.slice(0,1))).toThrow();expect(()=>validateParts(valid.size,[parts[0],{...parts[1],Size:20}])).toThrow();expect(()=>validateParts(valid.size,[parts[0],parts[0]])).toThrow()})
})

import {describe,it,expect} from 'vitest';
import {videoSource,parseTime,replayPoints,matchesRallyLength,replayRange} from '../video-review';
import type {TimelinePoint} from '../tracking';
describe('video review',()=>{
 it('accepts supported sources without trusting lookalike hosts',()=>{expect(videoSource('https://youtu.be/abcdefghijk?t=23')?.id).toBe('abcdefghijk');expect(videoSource('https://youtube.com/live/abcdefghijk')?.id).toBe('abcdefghijk');expect(videoSource('https://youtube.com.evil.test/watch?v=abcdefghijk')).toBeNull();expect(videoSource('javascript:alert(1)')).toBeNull();expect(videoSource('https://example.org/match.mp4')?.kind).toBe('file')});
 it('joins rallies by identity and excludes invalid timestamps',()=>{const points=[{id:'b'},{id:'a'},{id:'missing'}] as TimelinePoint[];expect(replayPoints(points,[{id:'a',start:20,end:10,touches:[]},{id:'b',start:0,end:12,touches:[]}]).map(p=>p.start)).toEqual([0,null,null])});
 it('parses full broadcast times and rejects malformed input',()=>{expect(parseTime('06:10:00')).toBe(22200);expect(parseTime('12:34')).toBe(754);expect(parseTime('12:99')).toBeNull();expect(parseTime('-1:30')).toBeNull()});
});

it('separates unrecorded rally lengths and range boundaries',()=>{expect(matchesRallyLength(null,'short')).toBe(false);expect(matchesRallyLength(null,'unknown')).toBe(true);expect(matchesRallyLength(3,'short')).toBe(true);expect(matchesRallyLength(4,'short')).toBe(false);expect(matchesRallyLength(6,'medium')).toBe(true);expect(matchesRallyLength(7,'long')).toBe(true);expect(matchesRallyLength(9,'long')).toBe(true);expect(matchesRallyLength(10,'extended')).toBe(true)});

it('pads manual timestamps by three seconds and respects video boundaries',()=>{expect(replayRange(100,120)).toEqual({start:97,end:123});expect(replayRange(1,10,12)).toEqual({start:0,end:12});expect(replayRange(null,null)).toBeNull();expect(replayRange(100,120,90)).toBeNull()});

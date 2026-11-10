import {it,expect} from 'vitest';
import {scoutToVideo,videoToScout,validScoutingAlignment,type ScoutingAlignment} from '../scouting-alignment';
const alignment:ScoutingAlignment={version:1,offsetSeconds:14027.683626049591,method:'Reviewed changeover edit',segments:[{sourceFrom:14733.7,offsetSeconds:13985.683626049591}]};
it('retains opening anchor and maps middle/end after inserted footage',()=>{
 expect(scoutToVideo(14037.08360904959,0,alignment)).toBeCloseTo(9.399983);
 expect(scoutToVideo(16351.398,0,alignment)).toBeCloseTo(2365.714374);
 expect(scoutToVideo(18826.639626,0,alignment)).toBeCloseTo(4840.956);
});
it('uses the new offset exactly at a boundary and supports switching sources',()=>{
 for(const t of [14037,14733.699,14733.7,16351,18826])expect(videoToScout(scoutToVideo(t,0,alignment),0,alignment)).toBeCloseTo(t);
 const insertedStart=14733.7-alignment.offsetSeconds;
 expect(videoToScout(insertedStart+20,0,alignment)).toBe(14733.7);
});
it('preserves single-offset and original-broadcast behavior',()=>{
 expect(scoutToVideo(100,10)).toBe(90);expect(videoToScout(90,10)).toBe(100);
 expect(scoutToVideo(15000,0)).toBe(15000);
 expect(scoutToVideo(15000,0,{...alignment,segments:undefined})).toBeCloseTo(972.316374);
});
it('rejects unordered, invalid or ambiguous segment mappings',()=>{
 expect(validScoutingAlignment(alignment)).toBe(true);
 for(const segments of [[{sourceFrom:NaN,offsetSeconds:0}],[{sourceFrom:1,offsetSeconds:15000}],[{sourceFrom:2,offsetSeconds:1},{sourceFrom:1,offsetSeconds:0}],[{sourceFrom:1,offsetSeconds:Infinity}]])expect(validScoutingAlignment({...alignment,segments})).toBe(false);
});

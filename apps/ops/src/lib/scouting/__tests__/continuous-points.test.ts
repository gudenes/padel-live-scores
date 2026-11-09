import {describe,it,expect} from 'vitest';
import {pointPlaybackWindows,nextPointPlayback,playbackSavings} from '../continuous-points';
describe('continuous point playback',()=>{
 it('pads, sorts and merges overlapping points without backward jumps',()=>{
  expect(pointPlaybackWindows([{start:20,end:25},{start:10,end:19}],100)).toEqual([{start:9,end:26.5}]);
 });
 it('excludes missing, reversed and out-of-video timings and clamps edges',()=>{
  expect(pointPlaybackWindows([{start:null,end:3},{start:5,end:4},{start:101,end:104},{start:-5,end:-1},{start:0,end:5},{start:95,end:102}],100)).toEqual([{start:0,end:6.5},{start:94,end:100}]);
 });
 it('keeps playback inside points, skips gaps and stops at the end',()=>{
  const windows=[{start:10,end:20},{start:30,end:40}];
  expect(nextPointPlayback(0,windows)).toBe(10);
  expect(nextPointPlayback(15,windows)).toBeNull();
  expect(nextPointPlayback(20,windows)).toBe(30);
  expect(nextPointPlayback(40,windows)).toBe('end');
  expect(nextPointPlayback(50,[])).toBeNull();
 });
});

it('calculates savings from the union of clipped windows, at original speed',()=>{
 expect(playbackSavings([{start:-5,end:20},{start:10,end:30},{start:80,end:110}],100)).toEqual({retained:50,saved:50,percent:50});
 expect(playbackSavings([],100)).toBeNull();
 expect(playbackSavings([{start:0,end:20}],0)).toBeNull();
});

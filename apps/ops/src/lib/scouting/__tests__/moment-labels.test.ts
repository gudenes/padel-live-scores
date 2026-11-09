import {describe,it,expect} from 'vitest';
import {cleanMomentLabels} from '../moment-labels';
describe('saved moment labels',()=>{
 it('accepts older bookmarks without labels',()=>{expect(cleanMomentLabels(undefined)).toEqual([])});
 it('normalizes and deduplicates custom labels',()=>{expect(cleanMomentLabels([' Taking  the net ','taking the net',null,'','Custom focus'])).toEqual(['Taking the net','Custom focus'])});
 it('bounds labels and preserves them through saved JSON',()=>{const labels=cleanMomentLabels(Array.from({length:15},(_,i)=>`${i} ${'x'.repeat(60)}`));expect(labels).toHaveLength(12);expect(labels.every(v=>v.length<=48)).toBe(true);expect(cleanMomentLabels(JSON.parse(JSON.stringify({labels})).labels)).toEqual(labels)});
});

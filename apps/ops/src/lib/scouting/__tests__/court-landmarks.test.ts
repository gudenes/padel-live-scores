import {describe,it,expect} from 'vitest';
import {referenceSignature,referenceConfirmed,validLandmarks,inferFloorReferences,type CourtLandmarks} from '../court-landmarks';
const corners=[{x:.2,y:.1},{x:.8,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const sample=():CourtLandmarks=>({version:1,coordinateSpace:'normalized-image',method:'astra',points:{'net-top-left':{x:.2,y:.5}}});
describe('calibration reviews',()=>{
 it('keeps AI points pending until reviewed and survives JSON storage',()=>{const v=sample();expect(referenceConfirmed(v,'Net',corners)).toBe(false);v.reviews={Net:{signature:referenceSignature(v,'Net',corners),confirmedAt:new Date().toISOString()}};const saved=JSON.parse(JSON.stringify(v));expect(validLandmarks(saved)).toBe(true);expect(referenceConfirmed(saved,'Net',corners)).toBe(true);expect(referenceConfirmed(saved,'Floor check',corners)).toBe(false)});
 it('invalidates changed geometry but not player positions',()=>{const v=sample();v.reviews={Net:{signature:referenceSignature(v,'Net',corners),confirmedAt:new Date().toISOString()}};expect(referenceConfirmed(v,'Net',[...corners,{x:1,y:1}])).toBe(true);expect(referenceConfirmed(v,'Net',[{x:.21,y:.1},...corners.slice(1)])).toBe(false);v.points['net-top-left'].x=.3;expect(referenceConfirmed(v,'Net',corners)).toBe(false)});
 it('does not overwrite observed markers or infer elevated doorway points',()=>{const v=sample();v.points['side-glass-left-far-bottom']={x:.3,y:.3};const inferred=inferFloorReferences(corners,v,2);expect(inferred.points['side-glass-left-far-bottom']).toEqual({x:.3,y:.3});expect(inferred.points['door-left-far-bottom'].inference).toBeTruthy();expect(inferred.points['door-left-far-top']).toBeUndefined();expect(referenceConfirmed(inferred,'Doorways',corners)).toBe(false)});
});

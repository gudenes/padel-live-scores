import {describe,it,expect} from 'vitest';
import {COURT_ZONES,savedPressureIndex,supportsCourtZones} from '../court-zones';
describe('court zones and saved pressure',()=>{
 it('uses the published schema and rejects incompatible bands',()=>{
 const schema={version:'net-depth-5-7-v2',distance_from:'net',attack_m:[0,5],transition_m:[5,7],defence_m:[7,10]};
 expect(supportsCourtZones(schema)).toBe(true);
 expect(supportsCourtZones({...schema,attack_m:[0,4]})).toBe(false);
 expect(supportsCourtZones(null)).toBe(false);
 expect(COURT_ZONES.reduce((sum,z)=>sum+z.far-z.near,0)).toBe(10);
 });
 it('preserves real zero scores and refuses missing, coerced or invalid values',()=>{
 expect(savedPressureIndex({pressure_index:0})).toBe(0);
 expect(savedPressureIndex({pressure_index:68.062})).toBe(68.062);
 expect(savedPressureIndex({pressure_index:100})).toBe(100);
 for(const value of [undefined,null,NaN,Infinity,-1,101,'68'])expect(savedPressureIndex({pressure_index:value})).toBeNull();
 expect(savedPressureIndex(undefined)).toBeNull();
 });
});

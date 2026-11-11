import {it,expect} from 'vitest';
import {playerSideHeat,playerSidePoint} from '../court-orientation';
it('combines equivalent positions across ends without losing observed time',()=>{
 expect(playerSideHeat({'2,3':5,'7,16':8,'2,16':2})).toEqual({'7,16':13,'2,16':2});
});
it('rotates both sprint endpoints together, preserving displacement',()=>{
 const a=playerSidePoint([2,4]),b=playerSidePoint([3,7],true);
 expect(a).toEqual([8,16]);expect(b).toEqual([7,13]);
 expect(Math.hypot(b[0]-a[0],b[1]-a[1])).toBeCloseTo(Math.sqrt(10));
 expect(playerSidePoint([8,16])).toEqual(a);
});

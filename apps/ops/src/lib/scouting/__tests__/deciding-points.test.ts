import {expect,it} from 'vitest';
import {decidingPoints} from '../deciding-points';
import type {TimelinePoint} from '../tracking';
const point=(rule:string,a:number,b:number,winner='a',phase='playing',returns=0)=>({winner,before:{config:{deuceRule:rule},currentGame:{a,b},phase,advantageReturns:returns}} as TimelinePoint);
it('counts golden points at 40-all but excludes tie-breaks and ordinary points',()=>{
 expect(decidingPoints([point('golden-point',40,40),point('golden-point',40,40,'b'),point('golden-point',40,30),point('golden-point',40,40,'a','tiebreak')])).toEqual([{rule:'golden-point',label:'Golden points',total:2,a:1,b:1}]);
});
it('counts only the deciding deuce in Star Point matches',()=>{
 expect(decidingPoints([point('star-point',40,40,'a','playing',0),point('star-point',40,40,'a','playing',1),point('star-point',40,40,'b','playing',2)])[0]).toMatchObject({total:1,a:0,b:1});
});
it('shows zero for the selected rule and no deciding-point row for advantage scoring',()=>{
 expect(decidingPoints([],'golden-point')[0]).toMatchObject({total:0,a:0,b:0});
 expect(decidingPoints([point('advantage',40,40)],'advantage')).toEqual([]);
});
it('uses only the points in the requested scope and supports legacy golden-point config',()=>{
 const p=point('golden-point',40,40);p.before.config={...p.before.config,deuceRule:undefined,goldenPoint:true};
 expect(decidingPoints([p])[0].total).toBe(1);
 expect(decidingPoints([],'star-point')[0].label).toBe('Star points');
});

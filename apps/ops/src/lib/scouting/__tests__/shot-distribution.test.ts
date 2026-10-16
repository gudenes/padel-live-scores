import {describe,it,expect} from 'vitest';
import {shotDistribution} from '../shot-distribution';
import type {TimelinePoint} from '../tracking';
const point=(props:Partial<TimelinePoint>)=>({outcome:'unforced',player:0,...props}) as TimelinePoint;
describe('shot distribution',()=>{
 it('keeps missing types in totals and filters outcomes',()=>{const {rows}=shotDistribution([point({shot:'volley'}),point({}),point({outcome:'winner',shot:'smash'})],'unforced');expect(rows[0]).toEqual({total:2,counts:{volley:1,unknown:1}})});
 it('credits the creator with their recorded shot, not the defender shot',()=>{const {rows}=shotDistribution([point({outcome:'forced',player:2,shot:'lob',forcedBy:0,previousPlayer:0,previousShot:'volley'}),point({outcome:'forced',player:2,shot:'lob',forcedBy:0,previousPlayer:1,previousShot:'smash'})],'created');expect(rows[0]).toEqual({total:2,counts:{volley:1,unknown:1}});expect(rows[2].total).toBe(0)});
 it('excludes unclassified score corrections and unattributed creations',()=>{expect(shotDistribution([point({outcome:'unclassified'}),point({outcome:'forced',forcedBy:undefined})],'created').rows.every(r=>r.total===0)).toBe(true)});
});

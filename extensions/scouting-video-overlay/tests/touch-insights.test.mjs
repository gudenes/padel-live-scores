import {test} from 'node:test';
import assert from 'node:assert/strict';
import {touchDirections,touchInsights} from '../touch-insights.mjs';
const order=[2,3,0,1],touch=player=>({player,order});
test('directions follow consecutive hitters; unknown endpoints and position changes stay unknown',()=>{
 assert.deepEqual(touchDirections([touch(0),touch(2),touch(1)]).map(t=>t.direction),['down-the-line','cross-court','unknown']);
 assert.equal(touchDirections([touch(0),touch(1)])[0].direction,'unknown');
 assert.equal(touchDirections([touch(0),{player:2,order:[1,0,3,2]}])[0].direction,'unknown');
 const flipped=[1,0,3,2];assert.equal(touchDirections([{player:0,order:flipped},{player:2,order:flipped}])[0].direction,'down-the-line');
 const rally={point:{},touches:[touch(0),touch(2)]};const result=touchInsights([rally,{...rally,undone:true},{touches:rally.touches}]);assert.equal(result.shots,2);assert.equal(result.trackedRallies,1);assert.equal(result.players[0].downTheLine,1);assert.equal(result.players[2].unknown,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {previousTapOpponent} from '../tap-selection.mjs';
test('suggests only the immediate opponent before the finishing player',()=>{
 const p=(...players)=>({touches:players.map(player=>({player}))});
 assert.equal(previousTapOpponent(p(0,3),3),0);
 assert.equal(previousTapOpponent(p(0,3,2),2),undefined);
 assert.equal(previousTapOpponent(p(0,3),2),undefined);
 assert.equal(previousTapOpponent(p(3),3),undefined);
 assert.equal(previousTapOpponent(p(),3),undefined);
});
import {firstTapReturn} from '../tap-selection.mjs';
test('only one opposing tap with a confirmed server suggests an unforced return',()=>{
 const p={touches:[{player:2}]};
 assert.equal(firstTapReturn(p,2,'unforced',0),true);
 for(const args of [[p,2,'forced',0],[p,2,'winner',0],[p,2,'unforced',3],[p,2,'unforced',0,false],[p,1,'unforced',0],[{touches:[{player:0},{player:2}]},2,'unforced',0]])assert.equal(firstTapReturn(...args),false);
});

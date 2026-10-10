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

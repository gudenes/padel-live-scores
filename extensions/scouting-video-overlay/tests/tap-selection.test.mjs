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
import {suggestedAssist,finalSmashAttempt} from '../tap-selection.mjs';
test('assist defaults require winner and final teammate-opponent-winner sequence',()=>{
 const p=(...players)=>({touches:players.map(player=>({player}))});
 assert.equal(suggestedAssist(p(1,2,0),0,'winner'),1);
 for(const [players,outcome] of [[[0,2,0],'winner'],[[1,0],'winner'],[[1,1,0],'winner'],[[1,2,0],'forced'],[[1,2,3],'winner']])assert.equal(suggestedAssist(p(...players),0,outcome),undefined);
});
test('smash default only reuses final recorded attempt, not an earlier smash by finisher',()=>{
 const touches=[{player:0,snapshot:{time:10}},{player:2,snapshot:{time:11}}];
 assert.equal(finalSmashAttempt({touches:touches.slice(0,1),attempts:[{player:0,touchIndex:0}]},0),0);
 assert.equal(finalSmashAttempt({touches,attempts:[{player:0,touchIndex:0}]},0),-1);
 assert.equal(finalSmashAttempt({attempts:[{player:0},{player:2}]},0),-1);
 assert.equal(finalSmashAttempt({attempts:[{player:0,smashType:'power'}]},0),0);
});

test('implicit serve credits only a confirmed server for a partner third-ball winner',()=>{
 const p=(...players)=>({touches:players.map(player=>({player}))});
 for(const server of [0,1,2,3]){
  const partner=server^1,returner=server<2?2:0;
  assert.equal(suggestedAssist(p(returner,partner),partner,'winner',server,true),server);
  assert.equal(suggestedAssist(p(returner,server),server,'winner',server,true),undefined);
  assert.equal(suggestedAssist(p(returner,partner),partner,'winner',server,false),undefined);
  for(const outcome of ['forced','unforced'])assert.equal(suggestedAssist(p(returner,partner),partner,outcome,server,true),undefined);
 }
 for(const server of [undefined,null,-1,4])assert.equal(suggestedAssist(p(2,1),1,'winner',server,true),undefined);
 for(const taps of [[1],[0,1],[4,1],[2,1,2,1]])assert.equal(suggestedAssist(p(...taps),1,'winner',0,true),undefined);
});

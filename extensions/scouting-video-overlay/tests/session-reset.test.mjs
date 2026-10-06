import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
test('switching leaves the current match safely saved and selecting it restores its records',async()=>{
 const selected={id:'m',tournamentId:'t',names:['A','B','C','D']},rallies=[{id:'point1'}];
 let disk={...fresh(),setup:{...defaults(),names:selected.names},selectedMatch:{...selected,tournamentName:'Rotterdam'},rallies,connection:{tabId:9},label:'Original label',catalog:{tournaments:[{id:'t',name:'Rotterdam'}],matchesByTournament:{t:[selected]}}};
 const dispatch=engine({read:async()=>structuredClone(disk),write:async state=>{disk=state;}});
 await dispatch({type:'leave-match'});assert.equal(disk.selectedMatch,null);assert.equal(disk.connection,null);assert.equal(disk.rallies.length,0);assert.deepEqual(disk.sessions.m.rallies,rallies);
 await dispatch({type:'select-match',tournamentId:'t',matchId:'m'});assert.deepEqual(disk.rallies,rallies);assert.equal(disk.label,'Original label');
 disk.pending={id:'unfinished'};await assert.rejects(dispatch({type:'leave-match'}),/Finish or cancel/);assert.equal(disk.selectedMatch.id,'m');
});
test('clearing search cache retains the active match, records and archived sessions',async()=>{
 let disk={...fresh(),selectedMatch:{id:'m'},rallies:[{id:'r'}],sessions:{previous:{rallies:[{id:'s'}]}},catalog:{tournaments:[{id:'t'}],matchesByTournament:{t:[{id:'m'}]}}};
 const before=structuredClone(disk);const dispatch=engine({read:async()=>structuredClone(disk),write:async state=>{disk=state;}});
 await dispatch({type:'clear-catalog'});assert.deepEqual(disk.catalog,{tournaments:[],matchesByTournament:{}});for(const key of ['selectedMatch','rallies','sessions'])assert.deepEqual(disk[key],before[key]);
});

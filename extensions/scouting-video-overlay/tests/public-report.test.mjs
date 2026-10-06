import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {publicReport} from '../public-report.mjs';
const snapshot=time=>({tabId:1,documentId:'private-doc',videoId:'v',mediaId:'m',page:'https://youtube.com/watch?v=private',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'});
const row=()=>({document:{...fresh(),setup:{...defaults(),startingScore:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:0},server:0,near:'a',advantageReturns:0}}},players:[0,1,2,3].map(i=>({id:String(i),name:'Player '+i})),updated_by:'private@example.com',updated_at:'2026-10-06T00:00:00Z'});
test('unfinished observations remain private; completed partial reports contain computed score and observed stats only',()=>{
 const r=row();assert.equal(publicReport(r),null);r.document.rallies=[{id:'last',start:snapshot(100),end:snapshot(110),point:{player:0,outcome:'winner',shot:'volley'}}];
 const report=publicReport(r);assert.deepEqual(report.sets,[{a:6,b:4},{a:6,b:4}]);assert.equal(report.partial,true);assert.equal(report.points,1);assert.equal(report.players[0].stats.winners,1);assert.equal(report.pairs.a.holds,1);
 assert.ok(!JSON.stringify(report).includes('private'));r.document.rallies[0].undone=true;r.document.rallies[0].undoneAt='2026-10-06T00:00:01Z';assert.equal(publicReport(r),null);
});

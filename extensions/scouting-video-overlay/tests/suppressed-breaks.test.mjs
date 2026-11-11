import {test} from 'node:test';
import assert from 'node:assert/strict';
import {match,defaults,scoutingDocument} from '../match.mjs';
import {replay,validateDoc,validateSuppressedBreaks} from '../generated/model.mjs';
import {validateVideoState} from '../server-model.mjs';
import {fresh} from '../core.mjs';
const snapshot=time=>({documentId:'d',videoId:'v',mediaId:'m',tabId:1,seekEpoch:0,readyState:4,time,at:'2026-11-11T00:00:00Z',paused:false,ended:false,seeking:false});
const session=()=>{
 const s={...fresh(),setup:{...defaults(),startingScore:{completed:[{a:3,b:6}],games:{a:4,b:4},points:{a:0,b:0},server:0,near:'a',advantageReturns:0}}};
 for(const player of [2,2,2,2,0,0,0,0,2,2,2,2]){const n=s.rallies.length;s.rallies.push({id:String(n),start:snapshot(n*20),end:snapshot(n*20+10),point:{player,outcome:'winner'}});}
 return s;
};
test('suppress only selected breaks; preserve every point, score and player/service statistic',()=>{
 const raw=session(),original=match(raw);
 raw.setup.suppressedBreaks=[{set:2,game:9},{set:2,game:10}];
 const validated=validateVideoState(raw),corrected=match(validated);
 assert.deepEqual(validated.setup.suppressedBreaks,raw.setup.suppressedBreaks);
 assert.deepEqual(corrected.score,original.score);
 assert.deepEqual(corrected.stats,original.stats);
 assert.deepEqual(corrected.tracking.service,original.tracking.service);
 assert.deepEqual(corrected.tracking.games,original.tracking.games);
 assert.equal(corrected.points,original.points);
 assert.equal(original.tracking.pairs.a.breaks,1);assert.equal(original.tracking.pairs.b.breaks,2);
 assert.equal(corrected.tracking.pairs.a.breaks,0);assert.equal(corrected.tracking.pairs.b.breaks,1);
 const expected=structuredClone(original.tracking);
 for(const p of expected.timeline)if(['3','7'].includes(p.id))p.breakConverted=false;
 expected.pairs.a.breaks--;expected.pairs.b.breaks--;
 assert.deepEqual(corrected.tracking,expected);
 assert.deepEqual(replay(validateDoc(scoutingDocument(validated))).tracking,corrected.tracking);
 assert.deepEqual(raw.rallies,session().rallies);
});
test('overrides are isolated by set and cannot decrement a hold or a missing game',()=>{
 const s=session(),original=match(s);
 s.setup.suppressedBreaks=[{set:1,game:9},{set:2,game:12}];
 assert.deepEqual(match(s),original);
});
test('reject invalid and duplicate game references',()=>{
 for(const value of [null,{},[{set:0,game:9}],[{set:2,game:14}],[{set:2,game:9.5}],[{set:2,game:9},{set:2,game:9}]])assert.throws(()=>validateSuppressedBreaks(value));
});

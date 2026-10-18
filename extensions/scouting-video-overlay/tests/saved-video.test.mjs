import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
import {savedVideoUrl,videoPageUrl} from '../replay-source.mjs';
const youtube='https://www.youtube.com/watch?v=dMeQPf-f4eg';
const redbull='https://www.redbull.tv/es_ES/page/rrn:content:live-videos:005e8406-5b64-4ba4-bd58-2f003f7f1cfb/match';
test('public video links strip tracking and reject unsafe or unsupported sources',()=>{
 assert.equal(videoPageUrl(youtube+'&token=secret'),youtube);
 assert.equal(videoPageUrl(redbull+'?cid=tracking#fragment'),redbull);
 for(const value of ['javascript:alert(1)','https://secret@www.youtube.com/watch?v=dMeQPf-f4eg','https://example.com/private?token=x'])assert.equal(videoPageUrl(value),null);
 assert.equal(savedVideoUrl({setup:{videoSourceUrl:youtube}}),youtube);
});
test('saved link survives cloud validation, restart and session switching without changing rallies',async()=>{
 let disk={...fresh(),selectedMatch:{id:'one',names:['A','B','C','D']}};
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)}});
 await dispatch({type:'save-video-url',url:redbull+'?cid=tracking'});
 assert.equal(savedVideoUrl(disk),redbull);
 assert.equal(validateVideoState(videoPayload(disk)).setup.videoPageUrl,redbull);
 const resumed=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)}});
 assert.equal(savedVideoUrl((await resumed({type:'state'})).state),redbull);
 disk.sessions={two:{setup:{...disk.setup,videoPageUrl:youtube},selectedMatch:{id:'two',names:['A','B','C','D']},rallies:[],cancelled:[],history:[]}};
 await resumed({type:'resume-session',matchId:'two'});
 await resumed({type:'resume-session',matchId:'one'});
 assert.equal(savedVideoUrl(disk),redbull);assert.equal(disk.rallies.length,0);
 await assert.rejects(resumed({type:'save-video-url',url:'javascript:alert(1)'}));
 assert.equal(savedVideoUrl(disk),redbull);
});
test('connecting a video automatically stores the original source with its session',async()=>{
 let disk={...fresh(),selectedMatch:{id:'one',names:['A','B','C','D']}};
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)},discover:async()=>({tabId:42,url:redbull+'?cid=tracking',videos:[{videoId:'v'}]})});
 await dispatch({type:'connect'});
 assert.equal(savedVideoUrl(disk),redbull);
 assert.equal(validateVideoState(videoPayload(disk)).setup.videoPageUrl,redbull);
});

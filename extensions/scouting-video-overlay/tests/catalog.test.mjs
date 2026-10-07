import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readAdminCatalog} from '../catalog.mjs';
const run=(env,request)=>runInNewContext(`(${readAdminCatalog.toString()})(request)`,{...env,request});
test('catalogue only reads fixed same-origin admin endpoints and returns match metadata',async()=>{
 let path,options;
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async(p,o)=>{path=p;options=o;return {ok:true,json:async()=>({matches:[{linkedMatchId:'m',team1Player1:{id:'a',name:'A',country:'ES',ranking:7},team1Player2:{name:'B',country:null,ranking:0},team1Player1Name:'A',team1Player2Name:'B',team2Player1Name:'C',team2Player2Name:'D',privatePayload:'not returned'},{linkedMatchId:null}]})}}};
 const id='00000000-0000-0000-0000-000000000001';
 const out=await run(env,{kind:'matches',tournamentId:id});
 assert.equal(path,'/api/internal/tournament-matches?tournament_id='+id);assert.equal(options.credentials,'same-origin');assert.equal(options.method,undefined);assert.equal(out.matches.length,1);assert.equal(out.matches[0].privatePayload,undefined);assert.equal(out.matches[0].id,'m');assert.equal(out.matches[0].players[0].country,'ES');assert.equal(out.matches[0].players[0].ranking,7);assert.equal(out.matches[0].players[1].ranking,null);
 await assert.rejects(run(env,{kind:'matches',tournamentId:'https://other.example'}));
 await assert.rejects(run({...env,location:{origin:'https://other.example'}},{kind:'tournaments'}));
});
test('expired operator login gives an actionable error',async()=>{
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async()=>({ok:false,status:401})};await assert.rejects(run(env,{kind:'tournaments'}),/Sign in to admin/);
});
test('year search stays on the approved endpoint and includes geography',async()=>{
 let path;
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async p=>{path=p;return {ok:true,json:async()=>({tournaments:[{id:'t',name:'Rotterdam',country:'Netherlands',location:'Rotterdam',starts_at:'2025-09-28',level:'p2'}]})}}};
 const out=await run(env,{kind:'tournaments',year:'2025'});
 assert.equal(path,'/api/internal/tournament-explorer?from=2025-01-01&to=2025-12-31');
 assert.equal(out.tournaments[0].country,'Netherlands');
 await assert.rejects(run(env,{kind:'tournaments',year:'2025&source=other'}),/valid year/);
});

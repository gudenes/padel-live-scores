// Offline only. Produces reviewable SQL, never connects to a database.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
export function renderPplRepair() {
 const data=JSON.parse(fs.readFileSync(new URL('./ppl-2026-11-18.json',import.meta.url),'utf8'));
 assert.equal(data.finals.length,28);
 assert.equal(new Set(data.finals.map(s=>s.providerId)).size,28);
 assert.equal(data.finals.filter(s=>s.tournamentSlug==='playa-del-carmen').length,24);
 assert.equal(data.finals.filter(s=>s.tournamentSlug==='mgm-pro-padel-league-las-vegas-2026').length,4);
 for(const s of data.finals){
  assert.equal(s.status,'finished'); assert.equal(s.game,null); assert.equal(s.playerIds.length,4);
  assert.ok(s.finishedAt); assert.ok([1,2].includes(s.winner));
  assert.ok(s.sets.length>=2&&s.sets.length<=3);
  let a=0,b=0;
  s.sets.forEach((set,i)=>{
   assert.equal(set.number,i+1);assert.equal(set.current,false);
   assert.ok(Number.isInteger(set.a)&&Number.isInteger(set.b)&&Math.min(set.a,set.b)>=0);
   const hi=Math.max(set.a,set.b),lo=Math.min(set.a,set.b);
   assert.ok(set.matchTiebreak ? hi>=10&&hi-lo>=2 : (hi===6&&lo<=4)||(hi===7&&(lo===5||lo===6)));
   if(set.a>set.b)a++;else b++;
  });
  assert.equal(s.winner===1?a:b,2);assert.ok(s.winner===1?b<2:a<2);
 }
 const json=JSON.stringify(data);assert.ok(!json.includes('$ppldata$'));
 return `begin;\ncreate temporary table ppl_repair_payload(body jsonb) on commit drop;\ninsert into ppl_repair_payload values($ppldata$${json}$ppldata$::jsonb);\n${fs.readFileSync(new URL('./ppl-2026-11-18.sql',import.meta.url),'utf8')}\ncommit;\n`;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Supply output SQL file path (offline only)');
 fs.writeFileSync(process.argv[2],renderPplRepair());console.log('Rendered static repair SQL; no database connection.');
}

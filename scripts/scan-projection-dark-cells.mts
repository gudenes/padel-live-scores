import pg from 'pg'
import fs from 'fs'
import { buildFirstRoundLeaves } from '../padelgod/src/lib/bracket-builder.js'
const url = fs.readFileSync('/Volumes/Crucial/dev/padel-live-scores/.env.local','utf8')
  .match(/^DATABASE_URL=(.*)$/m)![1].trim().replace(/^["']|["']$/g,'')
const c = new pg.Client({ connectionString: url }); await c.connect()
const { rows: tourns } = await c.query(
  `select id, name, level from tournaments
   where ends_at >= now() - interval '45 days' and starts_at is not null order by starts_at desc`)
const PREMIER=new Set(['p1','p2','major','premier_mens','premier_womens'])
const GRADED=new Set(['fip_bronze','fip_silver','fip_gold','fip_platinum'])
let tot=0; const rows_:any[]=[]
for (const t of tourns) for (const cat of ['men','women']) {
  if (!PREMIER.has(t.level) && !GRADED.has(t.level)) continue
  const { rows } = await c.query(
    `select id, round, round_canonical, widget_id_composite, status, winner_pair,
       pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed
     from matches where tournament_id=$1 and category=$2`,[t.id,cat])
  const main = rows.filter((r:any)=>!/^Q/.test(r.round_canonical??''))
  if (!main.length) continue
  const hasQ = rows.some((r:any)=>/^Q/.test(r.round_canonical??''))
  tot++
  const leaves = buildFirstRoundLeaves(main as any,(a:string,b:string)=>({
    pairKey:a<b?`${a}::${b}`:`${b}::${a}`, playerIds:[a,b] as [string,string], teamElo:1500 }))
  let both=0, one=0, none=0
  for (let i=0;i<leaves.length;i+=2){
    const f=(leaves[i]?1:0)+(leaves[i+1]?1:0)
    if (f===2) both++; else if (f===1) one++; else none++
  }
  const filled=leaves.filter(Boolean).length, need=leaves.length/2
  rows_.push({ n:`${t.name.slice(0,36)} [${t.level}]`, cat, slots:leaves.length,
    filled, need, blocked: filled<need, both, one, none, hasQ })
}
const dark = rows_.filter(r=>r.none>0)
console.log(`Premier + FIP-graded main draws, last 45 days: ${tot}\n`)
console.log(`Draws with >=1 first-round cell we know NOTHING about (both slots empty): ${dark.length} (${Math.round(dark.length/tot*100)}%)`)
console.log(`  ...of those, currently BLOCKED by the gate: ${dark.filter(r=>r.blocked).length}`)
console.log(`  ...of those, PUBLISHED anyway (dark cells simulated as byes): ${dark.filter(r=>!r.blocked).length}\n`)
console.log('draw'.padEnd(46)+'cat    filled/need  cells: full/half/DARK  quali  state')
console.log('-'.repeat(112))
for (const r of dark.sort((a,b)=>b.none-a.none).slice(0,22))
  console.log(r.n.padEnd(46)+`${r.cat.padEnd(6)} ${String(r.filled).padStart(3)}/${String(r.need).padEnd(4)}   `
    +`${String(r.both).padStart(4)}/${String(r.one).padStart(4)}/${String(r.none).padStart(4)}     ${r.hasQ?'yes':'no '}   ${r.blocked?'BLOCKED':'published'}`)
await c.end()

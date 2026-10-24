import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {intelligenceData} from '@/lib/scouting/intelligence/data'
import {aggregate,pairKey} from '@/lib/scouting/intelligence/model'
import {countryRanking} from '@/lib/scouting/intelligence/country-ranking'
import {benchmarks} from '@/lib/scouting/intelligence/benchmarks'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 if(!canViewReports((await auth())?.user))return Response.json({error:'Sign in with scouting access.'},{status:401})
 try{const q=new URL(request.url).searchParams,{people,matches:all,history:allHistory,excluded}=await intelligenceData(),year=q.get('year')??'',query=(q.get('q')??'').toLocaleLowerCase(),gender=q.get('gender')??'',watched=new Set((q.get('watched')??'').split(','));
 const years=[...new Set(allHistory.map(m=>m.date?.slice(0,4)).filter(Boolean))].sort().reverse()
 const history=allHistory.filter(m=>!year||m.date?.startsWith(year))
 const belongs=(m:typeof history[number],ids:string[])=>ids.every(id=>m.playerIds.includes(id))&&(ids.length!==2||Math.floor(m.playerIds.indexOf(ids[0])/2)===Math.floor(m.playerIds.indexOf(ids[1])/2))
 const matches=all.filter(m=>!year||m.date?.startsWith(year)),ids=(q.get('player')??'').split('~').filter(Boolean)
 if(ids.length){if(ids.length>2||ids.some(id=>!people.some(p=>p.id===id)))return Response.json({error:'Player not found.'},{status:404});const selected=matches.filter(m=>ids.every(id=>m.players.some(p=>p.id===id))&&(ids.length!==2||pairKey(m.players.slice(m.players.findIndex(p=>p.id===ids[0])<2?0:2,m.players.findIndex(p=>p.id===ids[0])<2?2:4).map(p=>p.id))===pairKey(ids)));const selectedHistory=history.filter(m=>belongs(m,ids));const partners=new Map<string,number>();for(const m of selectedHistory){const i=m.playerIds.indexOf(ids[0]),id=m.playerIds[i^1];if(id&&people.some(p=>p.id===id))partners.set(id,(partners.get(id)??0)+1)}
 return Response.json({people:ids.map(id=>{const p=people.find(p=>p.id===id)!;return {...p,countryRanking:countryRanking(p,people)}}),summary:aggregate(matches,ids),benchmarks:benchmarks(matches,ids.map(id=>people.find(p=>p.id===id)!)),matches:selected,history:selectedHistory,partners:[...partners].map(([id,count])=>({person:people.find(p=>p.id===id),count})),years,excluded},{headers:{'Cache-Control':'no-store'}})}
 const pairs=q.get('view')==='pairs',records=pairs?[...new Set(history.flatMap(m=>[m.playerIds.slice(0,2),m.playerIds.slice(2)].filter(ids=>ids.every(id=>id&&people.some(p=>p.id===id))).map(ids=>pairKey(ids as string[]))))].map(id=>({id,people:id.split('~').map(id=>people.find(p=>p.id===id)!)})):people.map(p=>({id:p.id,people:[p]}))
 const summaries=new Map(records.map(p=>[p.id,aggregate(matches,p.people.map(p=>p.id))]));let filtered=records.filter(r=>r.people.some(p=>p.name.toLocaleLowerCase().includes(query))&&(!gender||r.people.every(p=>p.category===gender))&&(q.get('filter')!=='watch'||r.people.some(p=>watched.has(p.id)))&&(q.get('filter')!=='scouted'||summaries.get(r.id)!.matches>0))
 const sort=q.get('sort')??'scouted';filtered.sort((a,b)=>{const x=summaries.get(a.id)!,y=summaries.get(b.id)!;return (sort==='name'?a.people[0].name.localeCompare(b.people[0].name):sort==='impact'?(y.matches?y.impact/y.matches:-Infinity)-(x.matches?x.impact/x.matches:-Infinity):sort==='rank'?a.people.reduce((n,p)=>n+(p.ranking??1e9),0)-b.people.reduce((n,p)=>n+(p.ranking??1e9),0):y.matches-x.matches)||a.id.localeCompare(b.id)})
 const page=Math.max(1,Math.min(Math.ceil(filtered.length/24)||1,Math.floor(Number(q.get('page')))||1)),count=filtered.length,scouted=filtered.filter(r=>summaries.get(r.id)!.matches).length
 return Response.json({rows:filtered.slice((page-1)*24,page*24).map(r=>({...r,summary:summaries.get(r.id),totalMatches:history.filter(m=>belongs(m,r.people.map(p=>p.id))).length,recentForm:history.filter(m=>belongs(m,r.people.map(p=>p.id))&&m.status==='finished'&&(m.winner===1||m.winner===2)&&m.date).slice(0,10).map(m=>({id:m.id,manual:m.manual,date:m.date,tournament:m.tournament,score:m.score,names:m.names,round:m.round,won:m.winner===Math.floor(m.playerIds.indexOf(r.people[0].id)/2)+1}))})),count,scouted,page,years,excluded,matchCount:history.length},{headers:{'Cache-Control':'no-store'}})
 }catch(e){console.error('Scouting intelligence load failed',e instanceof Error?e.message:e);return Response.json({error:'Player analysis could not be loaded. Please retry.'},{status:503})}
}

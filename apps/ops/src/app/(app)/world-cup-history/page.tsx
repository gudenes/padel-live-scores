import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { archiveFilters,archiveKinds,readWorldCupArchive } from '@/lib/world-cup-history'
export const dynamic='force-dynamic'
export const metadata={title:'World Cup Archive · PadelNachos Admin'}
export default async function WorldCupHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const session=await auth()
  if(!session?.user?.isOperator)redirect('/not-authorized')
  const raw=await searchParams
  const query=new URLSearchParams(Object.entries(raw).filter((p):p is [string,string]=>typeof p[1]==='string'))
  let filters:ReturnType<typeof archiveFilters>
  try { filters=archiveFilters(query) } catch { return <main className="pagebody"><h1>Invalid archive filters</h1><Link href="/world-cup-history">Reset filters</Link></main> }
  const {editions,records,total}=await readWorldCupArchive(filters)
  const edition=editions.find(e=>e.year===filters.year)
  const href=(patch:Record<string,string>)=>{const q=new URLSearchParams(query);for(const [k,v] of Object.entries(patch))q.set(k,v);return `/world-cup-history?${q}`}
  const summary=(r:typeof records[number])=>{
    const p=r.payload
    if(r.kind==='podium')return `${p.hostCity} · Gold: ${p.gold} · Silver: ${p.silver} · Bronze: ${p.bronze}`
    if(r.kind==='squad')return `${p.country} · ${p.players.length} players`
    if(r.kind==='match')return `${p.team1Player1Name??'TBC'} / ${p.team1Player2Name??'TBC'} vs ${p.team2Player1Name??'TBC'} / ${p.team2Player2Name??'TBC'} · ${p.result?.setScores??'No result available'}`
    if(r.kind==='tie')return `${p.home} vs ${p.away} · ${p.score?.join('–')??'Score unavailable'}`
    return p.title||p.label||p.name||r.external_id
  }
  return <main className="pagebody" style={{padding:24,maxWidth:1400}}>
    <h1>World Cup Archive</h1>
    <p>National-team editions · Structured source records for research and editorial use.</p>
    <nav aria-label="Edition" style={{display:'flex',gap:14,flexWrap:'wrap',margin:'20px 0'}}>{editions.map(e=><Link key={e.year} href={href({year:String(e.year),page:'1'})} aria-current={e.year===filters.year?'page':undefined}><strong>{e.year}</strong></Link>)}</nav>
    <h2>{edition?.name??'Edition not imported'}</h2>
    <p>{edition?.coverage.level==='podium-only'?'Podium records only. Match results and rosters have not yet been imported.':'Detailed archive. Coverage is source-dependent; missing results and unresolved player identities remain explicit.'}</p>
    <ul>{edition?.coverage.gaps?.map((gap:string)=><li key={gap}>{gap}</li>)}</ul>
    <nav aria-label="Record type" style={{display:'flex',gap:14,flexWrap:'wrap',margin:'20px 0'}}>{['',...archiveKinds].map(kind=><Link key={kind} href={href({kind,page:'1'})} aria-current={kind===filters.kind?'page':undefined}>{kind||'All records'}</Link>)}</nav>
    <nav aria-label="Category" style={{display:'flex',gap:14,marginBottom:20}}>{['','men','women','mixed'].map(category=><Link key={category} href={href({category,page:'1'})}>{category||'All categories'}</Link>)}</nav>
    <p>{total} records · <a href={`/api/internal/world-cup-history?${new URLSearchParams({year:String(filters.year),kind:filters.kind,category:filters.category})}`}>Download structured JSON</a></p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Type','Category','Record','Source'].map(h=><th key={h} style={{textAlign:'left',padding:12}}>{h}</th>)}</tr></thead><tbody>{records.map(r=><tr key={`${r.kind}:${r.category}:${r.external_id}`} style={{borderTop:'1px solid var(--border, #ddd)'}}>
      <td style={{padding:12,verticalAlign:'top'}}>{r.kind}</td><td style={{padding:12,verticalAlign:'top'}}>{r.category}</td>
      <td style={{padding:12}}><details><summary style={{cursor:'pointer'}}>{summary(r)}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{JSON.stringify(r.payload,null,2)}</pre></details></td>
      <td style={{padding:12,verticalAlign:'top'}}><a href={r.source_url} target="_blank" rel="noreferrer">Official source</a><br/><small>Captured {new Date(r.fetched_at).toISOString().slice(0,10)}</small></td>
    </tr>)}</tbody></table></div>
    {!records.length&&<p>No records for this selection.</p>}
    <nav aria-label="Pagination" style={{display:'flex',gap:20,marginTop:20}}>{filters.page>1&&<Link href={href({page:String(filters.page-1)})}>Previous</Link>}<span>Page {filters.page} of {Math.max(1,Math.ceil(total/50))}</span>{filters.page*50<total&&<Link href={href({page:String(filters.page+1)})}>Next</Link>}</nav>
  </main>
}

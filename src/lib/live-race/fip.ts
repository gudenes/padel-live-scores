import { load } from 'cheerio'
import https from 'node:https'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Breakdown } from './types.ts'

export function parseBreakdown(html: string): Breakdown {
  const $=load(html)
  const dateText=$('span').map((_,e)=>$(e).text().trim()).get().find(s=>/^\d{2}\/\d{2}\/\d{4}$/.test(s))
  if(!dateText) throw new Error('FIP profile has no publication date')
  const [d,m,y]=dateText.split('/')
  const tables=$('table#data-tournament-table, table#data-tournament-table-nc')
  if(!tables.length) throw new Error('FIP tournament breakdown missing')
  const results: Breakdown['results']=[]
  tables.find('tbody tr').each((_,row)=>{
    const cells=$(row).find('td').map((_,cell)=>$(cell).text().trim()).get()
    if(cells.length!==6) return
    const date=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[3])
    const points=Number(cells[5].replace(/[,.\s]/g,''))
    if(!date || !/^\d[\d,.\s]*$/.test(cells[5]) || !Number.isFinite(points)) throw new Error('Invalid FIP result')
    // Exclude youth/amateur circuits even if the player has a shared profile.
    if(!/PREMIER PADEL|FIP (PLATINUM|GOLD|SILVER|BRONZE)/i.test(cells[2])) return
    const iso=`${date[3]}-${date[2]}-${date[1]}`
    const key=`${cells[1]}:${iso}`
    if(results.some(r=>r.key===key)) throw new Error('Duplicate FIP tournament result')
    results.push({key,name:cells[1],date:iso,points})
  })
  return {date:`${y}-${m}-${d}`,results}
}

let preferredProxy: string | undefined
let requests=0
let bytes=0
let bandwidthDay=new Date().toISOString().slice(0,10)
export function fipUsage() { return {requests,bytes} }
async function proxyUrls(): Promise<string[]> {
  let saved:Record<string,string>={}
  try { saved=JSON.parse(await readFile(path.join(process.cwd(),'.local/race/proxy-config.json'),'utf8')) } catch {}
  const cfg={...saved,...process.env}
  const fixed=cfg.FIP_FIXED_PROXY_URLS ? JSON.parse(cfg.FIP_FIXED_PROXY_URLS) : [cfg.FIP_PROXY_URL].filter(Boolean)
  return [...new Set([...fixed,cfg.FIP_RESIDENTIAL_PROXY_URL].filter((v):v is string=>typeof v==='string' && !!v))]
}
function get(url:string,proxy?:string):Promise<string> {
  return new Promise((resolve,reject)=>{
    requests++
    const req=https.get(url,{agent:proxy?new HttpsProxyAgent(proxy):undefined,headers:{
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept:'text/html','Accept-Encoding':'gzip, deflate, br',
    }},res=>{
      const chunks:Buffer[]=[];let size=0
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;bytes+=chunk.length;if(size>2_000_000)req.destroy(new Error('FIP response too large'));else chunks.push(chunk)})
      res.on('end',()=>{
        if(res.statusCode!==200){reject(new Error(`FIP HTTP ${res.statusCode}`));return}
        try {
          const data=Buffer.concat(chunks),encoding=res.headers['content-encoding']
          resolve((encoding==='gzip'?gunzipSync(data):encoding==='br'?brotliDecompressSync(data):encoding==='deflate'?inflateSync(data):data).toString('utf8'))
        }catch{reject(new Error('Invalid FIP response encoding'))}
      })
      res.on('error',()=>reject(new Error('FIP response interrupted')))
    })
    req.setTimeout(15000,()=>req.destroy(new Error('FIP request timeout')))
    req.on('error',()=>reject(new Error('FIP connection unavailable')))
  })
}
export async function fetchBreakdown(url:string):Promise<Breakdown> {
  const target=new URL(url)
  // The profile URL is external data; restrict reads to the expected origin/path.
  if(target.protocol!=='https:' || target.hostname!=='www.padelfip.com' || !/^\/(?:es\/)?player\/[^/]+\/$/.test(target.pathname)) throw new Error('Invalid FIP profile URL')
  const day=new Date().toISOString().slice(0,10)
  if(day!==bandwidthDay){bandwidthDay=day;bytes=0;requests=0}
  if(bytes>50_000_000) throw new Error('FIP daily bandwidth limit reached; retries resume tomorrow')
  const proxies=await proxyUrls()
  const routes=preferredProxy?[preferredProxy]:[...proxies,undefined]
  let lastError:unknown
  for(const proxy of routes) {
    try {const parsed=parseBreakdown(await get(url,proxy));preferredProxy=proxy;return parsed}catch(e){lastError=e}
  }
  // Residential routes rotate: one retry, then wait for the next refresh cycle.
  if(preferredProxy) {try{return parseBreakdown(await get(url,preferredProxy))}catch(e){lastError=e}}
  throw lastError ?? new Error('FIP unavailable')
}

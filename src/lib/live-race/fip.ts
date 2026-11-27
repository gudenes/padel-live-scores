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

export interface FetchAttempt { route: string; httpStatus?: number; errorCode?: string; bytes: number; durationMs: number }
export class FipFetchError extends Error {
  code: string
  httpStatus?: number
  responseBytes: number
  constructor(code: string, httpStatus?: number, responseBytes=0) { super(code);this.code=code;this.httpStatus=httpStatus;this.responseBytes=responseBytes }
}
export const fetchErrorCode=(e:unknown)=>e instanceof FipFetchError?e.code:'FIP_PROFILE_PARSE_ERROR'
let requests=0, bytes=0
let bandwidthDay=new Date().toISOString().slice(0,10)
const cooldowns=new Map<string,number>()
export function fipUsage() { return {requests,bytes} }
interface Route { id:string; url?:string }
async function proxyRoutes():Promise<Route[]> {
  let saved:Record<string,string>={}
  if(process.env.NODE_ENV!=='production') {
    try {saved=JSON.parse(await readFile(path.join(process.cwd(),'.local/race/proxy-config.json'),'utf8'))} catch {}
  }
  const cfg={...saved,...process.env}
  let fixed:unknown
  try {fixed=cfg.FIP_FIXED_PROXY_URLS?JSON.parse(cfg.FIP_FIXED_PROXY_URLS):[cfg.FIP_PROXY_URL].filter(Boolean)} catch {throw new FipFetchError('FIP_PROXY_CONFIG_INVALID')}
  if(!Array.isArray(fixed)||fixed.some(v=>typeof v!=='string')) throw new FipFetchError('FIP_PROXY_CONFIG_INVALID')
  const routes:Route[]=[...new Set(fixed as string[])].map((url,i)=>({id:`fixed_${i+1}`,url}))
  if(cfg.FIP_RESIDENTIAL_PROXY_URL)routes.push({id:'residential',url:cfg.FIP_RESIDENTIAL_PROXY_URL})
  if(!routes.length) {
    if(process.env.NODE_ENV==='production')throw new FipFetchError('FIP_PROXY_NOT_CONFIGURED')
    routes.push({id:'direct'})
  }
  return [...routes.filter(r=>(cooldowns.get(r.id)??0)<=Date.now()),...routes.filter(r=>(cooldowns.get(r.id)??0)>Date.now())]
}
function validProfileUrl(url:string) {
  try {
    const u=new URL(url)
    return u.protocol==='https:'&&u.hostname==='www.padelfip.com'&&/^\/(?:es\/)?player\/[^/]+\/$/.test(u.pathname)
  } catch {return false}
}
interface Response { html:string; status:number; bytes:number }
function get(url:string,proxy?:string,redirects=0):Promise<Response> {
  return new Promise((resolve,reject)=>{
    requests++
    const req=https.get(url,{agent:proxy?new HttpsProxyAgent(proxy):undefined,headers:{
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept:'text/html','Accept-Encoding':'gzip, deflate, br',
    }},res=>{
      const chunks:Buffer[]=[];let size=0
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;bytes+=chunk.length;if(size>2_000_000)req.destroy(new FipFetchError('FIP_RESPONSE_TOO_LARGE',res.statusCode,size));else chunks.push(chunk)})
      res.on('end',()=>{
        const status=res.statusCode??0
        if([301,302,307,308].includes(status)&&res.headers.location&&redirects<3) {
          const next=new URL(res.headers.location,url).href
          if(validProfileUrl(next)) {get(next,proxy,redirects+1).then(r=>resolve({...r,bytes:r.bytes+size}),reject);return}
        }
        if(status!==200){reject(new FipFetchError(`FIP_HTTP_${status}`,status,size));return}
        try {
          const data=Buffer.concat(chunks),encoding=res.headers['content-encoding']
          const html=(encoding==='gzip'?gunzipSync(data):encoding==='br'?brotliDecompressSync(data):encoding==='deflate'?inflateSync(data):data).toString('utf8')
          resolve({html,status,bytes:size})
        }catch{reject(new FipFetchError('FIP_RESPONSE_ENCODING',status,size))}
      })
      res.on('error',()=>reject(new FipFetchError('FIP_RESPONSE_INTERRUPTED',res.statusCode,size)))
    })
    req.setTimeout(15000,()=>req.destroy(new FipFetchError('FIP_TIMEOUT')))
    req.on('error',e=>reject(e instanceof FipFetchError?e:new FipFetchError('FIP_CONNECTION_ERROR')))
  })
}
/** Audit every attempt, including failures recovered by fallback. */
export async function fetchFromRoutes(url:string,routes:Route[],request=get,onAttempt?:(a:FetchAttempt)=>Promise<void>):Promise<Breakdown> {
  let lastError:unknown
  for(const route of routes) {
    const started=Date.now();let response:Response|undefined;let parsed:Breakdown|undefined
    let failure:unknown
    try {response=await request(url,route.url);parsed=parseBreakdown(response.html)} catch(e) {failure=e instanceof FipFetchError?e:new FipFetchError('FIP_PROFILE_PARSE_ERROR',response?.status,response?.bytes);lastError=failure}
    const attempt:FetchAttempt={route:route.id,httpStatus:response?.status??(failure instanceof FipFetchError?failure.httpStatus:undefined),
      bytes:response?.bytes??(failure instanceof FipFetchError?failure.responseBytes:0),durationMs:Date.now()-started,
      ...(failure?{errorCode:fetchErrorCode(failure)}:{})}
    await onAttempt?.(attempt)
    if(parsed) {cooldowns.delete(route.id);return parsed}
    cooldowns.set(route.id,Date.now()+60_000)
  }
  throw lastError??new FipFetchError('FIP_UNAVAILABLE')
}
export async function fetchBreakdown(url:string,onAttempt?:(a:FetchAttempt)=>Promise<void>):Promise<Breakdown> {
  if(!validProfileUrl(url))throw new FipFetchError('FIP_PROFILE_URL_INVALID')
  const day=new Date().toISOString().slice(0,10)
  if(day!==bandwidthDay){bandwidthDay=day;bytes=0;requests=0}
  if(bytes>50_000_000)throw new FipFetchError('FIP_DAILY_BANDWIDTH_LIMIT')
  return fetchFromRoutes(url,await proxyRoutes(),get,onAttempt)
}

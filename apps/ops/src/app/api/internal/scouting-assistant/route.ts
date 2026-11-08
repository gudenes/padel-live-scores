import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {check} from '@/lib/rate-limit'
import {parseAssistantFilters,type AssistantFilters} from '@/lib/scouting/assistant-filters'
import {answerWithDatabase} from '@/lib/scouting/assistant-agent'
import {resolveAssistantSearch} from '@/lib/scouting/assistant-search'
export const runtime='nodejs'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(req:Request){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return json({error:'Sign in with a scouting account.'},401)
 const origin=req.headers.get('origin')
 if((origin&&new URL(origin).host!==(req.headers.get('host')||new URL(req.url).host))||req.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid request origin.'},403)
 if(!check(`match-assistant:${user.id}`,20,60_000).allowed)return json({error:'Too many questions. Please wait a minute.'},429)
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required.'},415)
 let body;try{const reader=req.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();return json({error:'Question is too long.'},413)}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();body=JSON.parse(text)}catch{return json({error:'Invalid request.'},400)}
 let filters:AssistantFilters;try{filters=parseAssistantFilters(body.filters)}catch{return json({error:'Invalid filters. Start a new conversation.'},400)}
 if(body.playerId!==undefined&&!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.playerId))return json({error:'Invalid player.'},400)
 if(!body.playerId&&(typeof body.question!=='string'||!body.question.trim()||body.question.length>2000))return json({error:'Enter a question of up to 2,000 characters.'},400)
 try{
  if(body.playerId)return json(await resolveAssistantSearch(filters,body.playerId))
  const history=Array.isArray(body.history)?body.history.slice(-6).filter((m:unknown):m is {role:'user'|'assistant';text:string}=>!!m&&typeof m==='object'&&['user','assistant'].includes((m as any).role)&&typeof (m as any).text==='string').map((m:{role:'user'|'assistant';text:string})=>({role:m.role,text:m.text.slice(0,2000)})):[]
  return json(await answerWithDatabase(body.question.trim(),filters,history,resolveAssistantSearch))
 }catch(e){const message=e instanceof Error?e.message:'';const safe=/^(OpenAI|Could not interpret|Invalid assistant|Invalid match|Start date|Choose a player|The assistant)/.test(message);return json({error:safe?message:'Match search is unavailable. Please retry.'},503)}
}

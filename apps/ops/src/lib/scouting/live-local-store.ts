import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises'
import path from 'node:path'
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function liveLocalEnabled(request:Request){return process.env.SCOUT_LIVE_EXPERIMENT==='1'&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)}
export function localLiveStore(root=path.join(process.cwd(),'.local','live-scout')){
 function file(id:string){if(!uuid.test(id))throw Error('Invalid match.');return path.join(root,id+'.json')}
 async function read(id:string){try{return JSON.parse(await readFile(file(id),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}}
 async function update(id:string,change:(old:any)=>Promise<any>){
  const target=file(id);await mkdir(root,{recursive:true});const lock=target+'.lock'
  try{await mkdir(lock)}catch{throw Error('Another save is in progress. Retry shortly.')}
  const temp=target+'.'+crypto.randomUUID()+'.tmp'
  try{const next=await change(await read(id));await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,target);return next}finally{await rm(temp,{force:true});await rm(lock,{recursive:true,force:true})}
 }
 return {read,update}
}

import {readdir,stat} from 'node:fs/promises'
import path from 'node:path'
import {requirePlayAccess} from '@/lib/play-access'
import {avatarOwnerDirectory,validAvatarId} from '@/lib/avatar-local-store'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
 const access=await requirePlayAccess()
 const headers={'Cache-Control':'private, no-store'}
 if(!access)return Response.json({error:'not_found'},{status:404,headers})
 try{
  let ids:string[]
  if(process.env.NODE_ENV==='production'){
   const {data,error}=await access.supabase.storage.from('play-avatars').list(access.userId,{limit:100,sortBy:{column:'created_at',order:'desc'}})
   if(error)throw error
   ids=(data??[]).map(file=>file.name.replace(/\.png$/,''))
  }else{
   const directory=avatarOwnerDirectory(access.userId)
   const files=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error})
   const entries=await Promise.all(files.filter(name=>name.endsWith('.png')&&validAvatarId(name.slice(0,-4))).map(async name=>({id:name.slice(0,-4),time:(await stat(path.join(directory,name))).mtimeMs})))
   ids=entries.sort((a,b)=>b.time-a.time).map(entry=>entry.id)
  }
  return Response.json({avatars:ids.filter(validAvatarId).map(id=>`custom:${id}`)},{headers})
 }catch{return Response.json({error:'unavailable'},{status:503,headers})}
}

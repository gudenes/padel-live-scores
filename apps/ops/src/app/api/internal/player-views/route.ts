import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {listPlayerViews,mutatePlayerViews} from '@/lib/scouting/intelligence/player-view-store'
import {parseViewMutation,ViewError} from '@/lib/scouting/intelligence/account-player-views'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(request?:Request){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return json({error:'Sign in with scouting access.'},401)
 if(request?.headers.has('x-view-account')&&request.headers.get('x-view-account')!==user.id)return json({error:'Your account changed. Refresh this page.'},409)
 try{return json({views:await listPlayerViews(user.id)})}catch{return json({error:'Could not load your saved views. Please retry.'},503)}
}
export async function POST(request:Request){
 const user=(await auth())?.user
 if(!user?.id||!canViewReports(user))return json({error:'Sign in with scouting access.'},401)
 if(!hasAdminRequestOrigin(request))return json({error:'Invalid request origin.'},403)
 if(request.headers.has('x-view-account')&&request.headers.get('x-view-account')!==user.id)return json({error:'Your account changed. Refresh this page.'},409)
 let mutation
 try{
  const raw=await request.text()
  if(raw.length>1000000)return json({error:'Request is too large.'},413)
  mutation=parseViewMutation(JSON.parse(raw))
 }catch(e){return json({error:e instanceof Error?e.message:'Invalid request.'},400)}
 try{return json({views:await mutatePlayerViews(user.id,mutation)})}
 catch(e){return json({error:e instanceof ViewError?e.message:'Could not save your views. Your changes are still in the editor.'},e instanceof ViewError?e.status:503)}
}

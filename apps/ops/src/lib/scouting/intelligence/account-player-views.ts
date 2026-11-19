import {readSavedView,type SavedPlayerView} from './saved-player-views'
export type AccountPlayerView=SavedPlayerView & {revision:number}
export class ViewError extends Error {constructor(message:string,public status=400){super(message)}}
export type ViewMutation={action:'save';view:SavedPlayerView;revision:number}|{action:'delete';id:string;revision:number}|{action:'import';views:SavedPlayerView[]}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function view(input:unknown){
 const parsed=readSavedView(input)
 if(!uuid(parsed.id)||parsed.name.trim().length>80||parsed.search.q.length>200||!/^$|^\d{4}$/.test(parsed.search.year))throw new ViewError('Invalid saved view.')
 return {...parsed,id:parsed.id.toLowerCase(),name:parsed.name.trim()}
}
export function parseViewMutation(input:unknown):ViewMutation {
 if(!input||typeof input!=='object')throw new ViewError('Invalid request.')
 const b=input as Record<string,unknown>
 if(b.action==='import'){
  if(!Array.isArray(b.views)||b.views.length>100)throw new ViewError('Import up to 100 views at a time.')
  return {action:'import',views:b.views.map(view)}
 }
 if(!Number.isInteger(b.revision)||Number(b.revision)<0)throw new ViewError('Invalid view revision.')
 if(b.action==='save')return {action:'save',view:view(b.view),revision:Number(b.revision)}
 if(b.action==='delete'&&uuid(b.id)&&Number(b.revision)>0)return {action:'delete',id:b.id,revision:Number(b.revision)}
 throw new ViewError('Invalid request.')
}

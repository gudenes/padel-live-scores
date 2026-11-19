import {pgPool} from '@/lib/db'
import {ViewError,type AccountPlayerView,type ViewMutation} from './account-player-views'
import {readSavedView,sameSearch,serializeRules,type SavedPlayerView} from './saved-player-views'
type Row={id:string;name:string;definition:Pick<SavedPlayerView,'match'|'rules'|'search'>;revision:number;deleted_at:string|null}
const fromRow=(r:Row):AccountPlayerView=>({...readSavedView({...r.definition,id:r.id,name:r.name}),revision:r.revision})
const listSql='select id,name,definition,revision,deleted_at from scouting_player_views where user_id=$1 and deleted_at is null order by created_at,id'
export async function listPlayerViews(userId:string){return (await pgPool().query<Row>(listSql,[userId])).rows.map(fromRow)}
export async function mutatePlayerViews(userId:string,mutation:ViewMutation){
 const db=await pgPool().connect()
 try{
  await db.query('BEGIN')
  // Serialize changes for this account only, including imports from multiple devices.
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[userId])
  const rows=(await db.query<Row>('select id,name,definition,revision,deleted_at from scouting_player_views where user_id=$1',[userId])).rows
  const active=rows.filter(r=>!r.deleted_at)
  const insert=async(v:SavedPlayerView)=>{
   if(active.length>=100)throw new ViewError('You can save up to 100 views.')
   const definition={match:v.match,rules:v.rules,search:v.search}
   await db.query('insert into scouting_player_views(user_id,id,name,definition) values($1,$2,$3,$4)',[userId,v.id,v.name,JSON.stringify(definition)])
   const row={id:v.id,name:v.name,definition,revision:1,deleted_at:null};rows.push(row);active.push(row)
  }
  if(mutation.action==='import'){
   for(const v of mutation.views){
    if(rows.some(r=>r.id===v.id))continue // Includes tombstones; never restore or overwrite.
    const equivalent=rows.some(r=>r.name.toLowerCase()===v.name.toLowerCase()&&serializeRules(fromRow(r))===serializeRules(v)&&sameSearch(r.definition.search,v.search))
    if(equivalent)continue
    let name=v.name,n=2
    while(active.some(r=>r.name.toLowerCase()===name.toLowerCase())){const suffix=' (imported '+(n++)+')';name=v.name.slice(0,80-suffix.length)+suffix}
    await insert({...v,name})
   }
  }else{
   const id=mutation.action==='save'?mutation.view.id:mutation.id
   const old=rows.find(r=>r.id===id)
   if(mutation.action==='delete'){
    if(!old||old.deleted_at)throw new ViewError('View not found.',404)
    if(old.revision!==mutation.revision)throw new ViewError('This view changed on another device. Close and reopen the editor before trying again.',409)
    await db.query('update scouting_player_views set deleted_at=now(),updated_at=now(),revision=revision+1 where user_id=$1 and id=$2',[userId,id])
   }else{
    if(old?.deleted_at||(!old&&mutation.revision!==0)||(old&&old.revision!==mutation.revision))throw new ViewError('This view changed on another device. Close and reopen the editor before trying again.',409)
    if(active.some(r=>r.id!==id&&r.name.toLowerCase()===mutation.view.name.toLowerCase()))throw new ViewError('A view with this name already exists.',409)
    if(!old)await insert(mutation.view)
    else await db.query('update scouting_player_views set name=$3,definition=$4,updated_at=now(),revision=revision+1 where user_id=$1 and id=$2',[userId,id,mutation.view.name,JSON.stringify({match:mutation.view.match,rules:mutation.view.rules,search:mutation.view.search})])
   }
  }
  const views=(await db.query<Row>(listSql,[userId])).rows.map(fromRow)
  await db.query('COMMIT')
  return views
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}

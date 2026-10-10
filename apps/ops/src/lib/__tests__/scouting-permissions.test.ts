import {expect,it} from 'vitest'
import {canScout,canWriteSession,scouterRouteAllowed} from '../scouting-permissions'
const id='11111111-1111-4111-8111-111111111111'
it('separates admin, scouter and public identities',()=>{
 expect(canScout(null)).toBe(false);expect(canScout({id})).toBe(false)
 expect(canScout({id,isScouter:true})).toBe(true);expect(canScout({isOperator:true})).toBe(true)
})
it('allows report reads but never editor writes, admin routes or unexpected methods',()=>{
 for(const p of [`/scouting/${id}/report`,`/scouting/manual/${id}/report`,`/api/internal/scouting/${id}`,`/api/internal/video-scouting/${id}`])expect(scouterRouteAllowed(p,'GET')).toBe(true)
 for(const [p,m] of [['/team-access','GET'],['/today','POST'],[`/scouting/${id}`,'GET'],[`/api/internal/scouting/${id}`,'POST'],[`/api/internal/video-scouting/${id}`,'DELETE'],['/api/internal/tournament-explorer','POST'],['/api/internal/new-admin-feature','GET'],['/scouting','POST'],[`/scouting/${id}/report/extra`,'GET']])expect(scouterRouteAllowed(p,m)).toBe(false)
})
it('allows required catalogue and sync routes with exact methods',()=>{
 for(const p of ['/api/internal/scouting-extension/session','/api/internal/scouting-catalog','/api/internal/scouting-coaches','/api/internal/tournament-matches','/api/internal/tournament-explorer'])expect(scouterRouteAllowed(p,'GET')).toBe(true)
 expect(scouterRouteAllowed('/api/internal/manual-scouting-matches','POST')).toBe(true)
 expect(scouterRouteAllowed(`/api/internal/manual-video-scouting/${id}`,'POST')).toBe(true)
})
it('only allows own-session writes and preserves admin access to legacy records',()=>{
 const scout={id,isScouter:true}
 expect(canWriteSession(scout,null)).toBe(true)
 expect(canWriteSession(scout,{assigned_scouter_user_id:id})).toBe(true)
 expect(canWriteSession(scout,{assigned_scouter_user_id:'someone-else'})).toBe(false)
 expect(canWriteSession(scout,{assigned_scouter_user_id:null})).toBe(false)
 expect(canWriteSession({isOperator:true},{assigned_scouter_user_id:null})).toBe(true)
 expect(canWriteSession({id},null)).toBe(false)
})

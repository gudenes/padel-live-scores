import {describe,it,expect} from 'vitest'
import {contactCandidates} from '../contact-candidates'
const m={coverage:[[0,2,1]],sourceDimensions:[1000,1000],players:[{key:'p0',name:'A'}]}
function data(moving=true){const poses=Array.from({length:5},(_,i)=>{const k=Array.from({length:17},()=>[100,100,.95]);k[5]=[90,100,.95];k[6]=[110,100,.95];k[11]=[90,140,.95];k[12]=[110,140,.95];k[9]=[100+(moving?i*10:0),150,.95];k[15]=[90,200,.95];k[16]=[110,200,.95];return {t:i/30,players:{p0:k}}});return [{poses,rows:poses.map(p=>({source_s:p.t,segment_id:1,overlay_visible:true,players:{p0:{court_m:[2,18],position_source:'observed'}}}))}]}
describe('possible contact proposals',()=>{
 it('proposes a wrist swing with serve-position hint',()=>{const c=contactCandidates(m,data());expect(c).toHaveLength(1);expect(c[0].serveHint).toBe(true);expect(c[0].player).toBe('A')})
 it('ignores stationary poses',()=>expect(contactCandidates(m,data(false))).toHaveLength(0))
 it('does not compare across cuts',()=>expect(contactCandidates({...m,coverage:[[0,.05,1],[.1,2,2]]},data())).toHaveLength(0))
 it('ignores inferred player positions',()=>{const d=data();d[0].rows.forEach(r=>r.players.p0.position_source='inferred');expect(contactCandidates(m,d)).toHaveLength(0)})
})

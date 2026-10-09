import {expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
vi.mock('@/lib/auth',()=>({auth:(callback:unknown)=>callback}))
import {proxy} from '../../proxy'
async function request(path:string,method='GET',user:any={id:'scout',isScouter:true}){
 const req=new NextRequest('https://admin.test'+path,{method}) as any
 req.auth=user?{user}:null
 return (proxy as any)(req)
}
it('routes a scouter to the scoped workspace after login',async()=>{
 for(const p of ['/','/today','/login']){
  const response=await request(p)
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe('https://admin.test/scouting')
 }
})
it('blocks privileged pages, API mutations and arbitrary server actions',async()=>{
 for(const [p,m] of [['/team-access','GET'],['/system/feature-flags','GET'],['/api/internal/team-access','POST'],['/scouting','POST'],['/api/internal/unknown','GET']]){
  expect((await request(p,m)).status).toBe(403)
 }
})
it('preserves administrator access and permits scoped report pages',async()=>{
 expect((await request('/team-access','GET',{id:'admin',isOperator:true})).status).toBe(200)
 expect((await request('/scouting')).status).toBe(200)
})

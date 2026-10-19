import {it,expect,vi,beforeEach,afterEach} from 'vitest'
const mocks=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),send:vi.fn()}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query,connect:async()=>({query:mocks.query,release:mocks.release})})}))
vi.mock('@/lib/email/report-code',()=>({sendReportCode:mocks.send}))
import {POST} from '../route'
import {codeDigest} from '@/lib/scouting/share-verification'
const token='a'.repeat(43),id='11111111-1111-4111-8111-111111111111'
const req=(body:unknown,origin='https://admin.test')=>new Request(`https://admin.test/api/shared/report/${token}/verify`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
const ctx={params:Promise.resolve({token})}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('AUTH_SECRET','test-secret');mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('select token_hash')?[{token_hash:'x'}]:[]}))})
afterEach(()=>vi.unstubAllEnvs())
it('rejects cross-origin requests before touching storage',async()=>{expect((await POST(req({action:'request',email:'me@example.com'},'https://evil.test'),ctx)).status).toBe(403);expect(mocks.query).not.toHaveBeenCalled()})
it('revoked links cannot request codes',async()=>{mocks.query.mockResolvedValue({rows:[]});expect((await POST(req({action:'request',email:'me@example.com'}),ctx)).status).toBe(404);expect(mocks.send).not.toHaveBeenCalled()})
it('expired, consumed or exhausted challenges cannot create sessions',async()=>{expect((await POST(req({action:'verify',challengeId:id,code:'123456'}),ctx)).status).toBe(400);expect(mocks.query.mock.calls.some(([sql])=>sql.includes('insert into report_share_visitors'))).toBe(false);expect(mocks.query.mock.calls.find(([sql])=>sql.includes('select * from report_share_codes'))?.[0]).toContain('attempts<5')})
it('wrong codes increment attempts and log failure without a cookie',async()=>{
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('select * from report_share_codes')?{rows:[{id,email:'me@example.com',code_hash:codeDigest(id,'123456')}]}:base(sql,...args))
 const response=await POST(req({action:'verify',challengeId:id,code:'654321'}),ctx);expect(response.status).toBe(400);expect(response.headers.get('set-cookie')).toBeNull();expect(mocks.query.mock.calls.some(([sql])=>sql.includes('attempts=attempts+1'))).toBe(true)
})
it('verified codes create a report-scoped httpOnly session and audit event',async()=>{
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('select * from report_share_codes')?{rows:[{id,email:'me@example.com',code_hash:codeDigest(id,'123456')}]}:base(sql,...args))
 const response=await POST(req({action:'verify',challengeId:id,code:'123456'}),ctx);expect(response.status).toBe(200);const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly');expect(cookie).toContain('/shared/report/'+token);expect(mocks.query.mock.calls.some(([sql,args])=>sql.includes('report_share_activity')&&args.includes('verified'))).toBe(true)
})
it('delivery failures are tracked and do not return a usable challenge',async()=>{
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('count(*) filter')?{rows:[{recipient:0,ip:0,link:0,recent:0}]}:base(sql,...args));mocks.send.mockRejectedValue(Error('provider rejected'))
 const response=await POST(req({action:'request',email:'me@example.com'}),ctx);expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty('challengeId');expect(mocks.query.mock.calls.some(([sql])=>sql.includes("'delivery_failed'"))).toBe(true)
})
it('rate limits prevent sending more email',async()=>{
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('count(*) filter')?{rows:[{recipient:5,ip:5,link:5,recent:0}]}:base(sql,...args));expect((await POST(req({action:'request',email:'me@example.com'}),ctx)).status).toBe(429);expect(mocks.send).not.toHaveBeenCalled()
})
it('short links receive a session scoped to the short report path',async()=>{
 const short='b'.repeat(22),base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('select * from report_share_codes')?{rows:[{id,email:'me@example.com',code_hash:codeDigest(id,'123456')}]}:base(sql,...args))
 const response=await POST(req({action:'verify',challengeId:id,code:'123456'}),{params:Promise.resolve({token:short})});expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('Path=/s/'+short)
})

it('sends a code from the production admin origin behind the hosting proxy',async()=>{
 vi.stubEnv('NODE_ENV','production');mocks.send.mockResolvedValue(undefined)
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('count(*) filter')?{rows:[{recipient:0,ip:0,link:0,recent:0}]}:base(sql,...args))
 const response=await POST(new Request(`http://internal:8080/api/shared/report/${token}/verify`,{method:'POST',headers:{origin:'https://admin.padelnachos.com'},body:JSON.stringify({action:'request',email:'me@example.com'})}),ctx)
 expect(response.status).toBe(200);expect(await response.json()).toHaveProperty('challengeId');expect(mocks.send).toHaveBeenCalledWith('me@example.com',expect.stringMatching(/^\d{6}$/))
})
it('verifies codes behind the hosting proxy and keeps secure report-scoped cookies',async()=>{
 vi.stubEnv('NODE_ENV','production')
 const base=mocks.query.getMockImplementation()!;mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>sql.includes('select * from report_share_codes')?{rows:[{id,email:'me@example.com',code_hash:codeDigest(id,'123456')}]}:base(sql,...args))
 const response=await POST(new Request(`http://internal:8080/api/shared/report/${token}/verify`,{method:'POST',headers:{origin:'https://admin.padelnachos.com'},body:JSON.stringify({action:'verify',challengeId:id,code:'123456'})}),ctx)
 expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('Secure');expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('set-cookie')).toContain('/shared/report/'+token)
})
it.each(['https://evil.test','http://internal:8080','null',''])('rejects untrusted production origin %s before storage or email',async origin=>{
 vi.stubEnv('NODE_ENV','production')
 const response=await POST(new Request(`http://internal:8080/api/shared/report/${token}/verify`,{method:'POST',headers:{...(origin?{origin}:{}),'x-forwarded-host':'admin.padelnachos.com'},body:JSON.stringify({action:'request',email:'me@example.com'})}),ctx)
 expect(response.status).toBe(403);expect(mocks.query).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled()
})

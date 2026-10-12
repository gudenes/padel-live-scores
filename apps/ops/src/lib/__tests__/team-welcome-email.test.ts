import {afterEach,expect,it,vi} from 'vitest'
import {teamWelcomeTemplate} from '../email/team-welcome-template'
const mock=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('resend',()=>({Resend:class{emails={send:mock.send}}}))
import {sendTeamWelcomeEmail} from '../email/team-welcome'
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()})
it.each(['viewer','scouter','admin'] as const)('renders branded HTML and plain text for %s',role=>{
 const email=teamWelcomeTemplate({email:'person@example.com',role})
 expect(email.html).toContain('https://admin.padelnachos.com/brand/padelnachos.png')
 expect(email.html).toContain('https://admin.padelnachos.com/brand/padellabs-white.png')
 expect(email.html).toContain('#c9f43b')
 expect(email.html).toContain('person@example.com')
 expect(email.text).toContain('https://admin.padelnachos.com/login')
 expect(email.text).toContain('Email me a sign-in link')
 expect(email.text).not.toContain('password is required to')
})
it('keeps viewer guidance read-only and scouting instructions specific to scouters',()=>{
 const viewer=teamWelcomeTemplate({email:'a@test.com',role:'viewer'}),scouter=teamWelcomeTemplate({email:'a@test.com',role:'scouter'})
 expect(viewer.text).toContain('read-only')
 expect(viewer.text).not.toContain('Record points')
 expect(scouter.text).toContain('Playground')
 expect(scouter.text).toContain('assigned to you')
})
it('escapes recipient data in HTML',()=>{
 const email=teamWelcomeTemplate({email:'<img src=x onerror="bad">&@test.com',role:'viewer'})
 expect(email.html).toContain('&lt;img src=x onerror=&quot;bad&quot;&gt;&amp;@test.com')
 expect(email.html).not.toContain('<img src=x')
})
it('passes both email formats to the existing service',async()=>{
 vi.stubEnv('RESEND_API_KEY','test-only')
 mock.send.mockResolvedValue({data:{id:'test-message'},error:null})
 await sendTeamWelcomeEmail({to:'person@example.com',role:'scouter'})
 expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({to:'person@example.com',subject:expect.stringContaining('Scouter'),html:expect.any(String),text:expect.any(String)}))
})
it('treats provider rejection and missing configuration as failures',async()=>{
 vi.stubEnv('RESEND_API_KEY','test-only')
 mock.send.mockResolvedValue({data:null,error:{message:'rejected'}})
 await expect(sendTeamWelcomeEmail({to:'a@test.com',role:'viewer'})).rejects.toThrow('not accepted')
 mock.send.mockClear();vi.stubEnv('RESEND_API_KEY','')
 await expect(sendTeamWelcomeEmail({to:'a@test.com',role:'viewer'})).rejects.toThrow('unavailable')
 expect(mock.send).not.toHaveBeenCalled()
})

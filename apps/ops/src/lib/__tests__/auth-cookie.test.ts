import {it,expect} from 'vitest'
import {sessionCookie} from '../auth-cookie'
it('keeps localhost sessions across dev and prebuilt previews',()=>{for(const url of ['http://localhost:8819','http://127.0.0.1:8819','http://[::1]:8819']){expect(sessionCookie(true,url)).toEqual(sessionCookie(false,url));expect(sessionCookie(true,url).options).toMatchObject({secure:false,domain:undefined,httpOnly:true,sameSite:'lax'})}})
it('preserves production cookie security outside explicit HTTP loopback',()=>{for(const url of [undefined,'invalid','https://admin.padelnachos.com','http://localhost.evil.test','http://user@localhost:8819'])expect(sessionCookie(true,url)).toMatchObject({name:'__Secure-authjs.session-token',options:{secure:true,domain:'.padelnachos.com',httpOnly:true}})})

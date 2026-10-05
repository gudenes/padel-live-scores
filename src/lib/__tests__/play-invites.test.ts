import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {invitationWindow,readInvitation,signInvitation} from '../play-invites'
const start=Date.parse('2026-10-05T00:00:00Z'),end=start+21*86400000
const id='12345678-1234-1234-1234-123456789012',origin='https://padelnachos.com'
beforeEach(()=>{vi.stubEnv('AUTH_SECRET','test-only-secret');vi.stubEnv('PLAY_INVITES_ENABLED','true');vi.stubEnv('PLAY_INVITES_START_AT','2026-10-05T00:00:00Z')})
afterEach(()=>vi.unstubAllEnvs())
describe('reusable invitation',()=>{
 it('opens only for the configured three weeks',()=>{expect(invitationWindow(start-1)).toBeNull();expect(invitationWindow(start)).toEqual({start,end});expect(invitationWindow(end)).toBeNull()})
 it('can be validated repeatedly until expiry',()=>{const token=signInvitation(id,origin,end);expect(readInvitation(token,origin,start)).toEqual({issuer:id,end});expect(readInvitation(token,origin,start+1)).not.toBeNull();expect(readInvitation(token,origin,end)).toBeNull()})
 it('rejects tampering and cross-environment use',()=>{const token=signInvitation(id,origin,end);expect(readInvitation('x'+token,origin,start)).toBeNull();expect(readInvitation(token,'http://localhost:3017',start)).toBeNull()})
 it('fails closed when disabled or unconfigured',()=>{const token=signInvitation(id,origin,end);vi.stubEnv('PLAY_INVITES_ENABLED','false');expect(readInvitation(token,origin,start)).toBeNull();vi.stubEnv('PLAY_INVITES_ENABLED','true');vi.stubEnv('PLAY_INVITES_START_AT','');expect(invitationWindow(start)).toBeNull()})
})

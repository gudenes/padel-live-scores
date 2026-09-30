import { afterEach, expect, it, vi } from 'vitest'
import { encryptAvatarKey, decryptAvatarKey, readProductionAvatarSettings } from '../production-avatar-settings'
afterEach(()=>vi.unstubAllEnvs())
it('encrypts credentials with authenticated random IVs and rejects tampering',()=>{
 vi.stubEnv('AVATAR_SETTINGS_ENCRYPTION_KEY','ab'.repeat(32))
 const one=encryptAvatarKey('sk-test-private'),two=encryptAvatarKey('sk-test-private')
 expect(one).not.toEqual(two);expect(JSON.stringify(one)).not.toContain('sk-test-private')
 expect(decryptAvatarKey(one)).toBe('sk-test-private')
 expect(()=>decryptAvatarKey({...one,tag:Buffer.alloc(16).toString('base64')})).toThrow()
})
it('fails closed without the encryption key',()=>{
 vi.stubEnv('AVATAR_SETTINGS_ENCRYPTION_KEY','')
 expect(()=>encryptAvatarKey('secret')).toThrow()
})
it('reads only the private singleton',async()=>{
 vi.stubEnv('AVATAR_SETTINGS_ENCRYPTION_KEY','ab'.repeat(32))
 const q={select:vi.fn(),eq:vi.fn(),single:vi.fn().mockResolvedValue({data:{enabled:true,encrypted_key:encryptAvatarKey('secret')},error:null})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q)
 const from=vi.fn().mockReturnValue(q)
 expect(await readProductionAvatarSettings({from} as never)).toEqual({enabled:true,apiKey:'secret'})
 expect(from).toHaveBeenCalledWith('avatar_provider_settings');expect(q.eq).toHaveBeenCalledWith('id',true)
})

import {it,expect,beforeEach,afterEach,vi} from 'vitest'
import {normalizeShareEmail,newShareCode,codeDigest,matchesCode} from '../share-verification'
beforeEach(()=>vi.stubEnv('AUTH_SECRET','test-secret'))
afterEach(()=>vi.unstubAllEnvs())
it('normalizes valid recipient addresses and rejects malformed input',()=>{expect(normalizeShareEmail(' Me@Example.com ')).toBe('me@example.com');for(const input of [null,'bad','a b@c.com','a@b'])expect(normalizeShareEmail(input)).toBeNull()})
it('uses six-digit codes bound to one challenge and rejects wrong codes',()=>{const code=newShareCode();expect(code).toMatch(/^\d{6}$/);const hash=codeDigest('challenge',code);expect(matchesCode('challenge',code,hash)).toBe(true);expect(matchesCode('other',code,hash)).toBe(false);expect(matchesCode('challenge','wrong',hash)).toBe(false);expect(hash).not.toContain(code)})
it('fails closed without configured signing secret',()=>{vi.stubEnv('AUTH_SECRET','');expect(()=>codeDigest('challenge','123456')).toThrow()})

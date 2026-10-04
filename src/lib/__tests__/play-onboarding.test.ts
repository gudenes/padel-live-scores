import {describe,it,expect} from 'vitest'
import {validPublicName,canAdvance} from '../play-onboarding'
describe('onboarding identity',()=>{
 it('accepts trimmed unicode public names',()=>{expect(validPublicName('  Lucía  ')).toBe(true)})
 it('rejects emails, controls, blank and oversized names',()=>{for(const value of ['a','  ','name@example.com','Na\nme','a'.repeat(25),null,5])expect(validPublicName(value)).toBe(false)})
 it('cannot skip identity or move backwards',()=>{expect(canAdvance('identity','done')).toBe(false);expect(canAdvance('wallet','identity')).toBe(false);expect(canAdvance('wallet','prediction')).toBe(true);expect(canAdvance('prediction','done')).toBe(true);expect(canAdvance('done','wallet')).toBe(false)})
})

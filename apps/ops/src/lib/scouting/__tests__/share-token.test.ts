import {describe,it,expect} from 'vitest'
import {newShareToken,newShortShareToken,validShareToken,shareTokenHash} from '../share-token'
describe('report share tokens',()=>{
 it('generates unguessable independent URL-safe tokens and stores only their hash',()=>{
  const a=newShareToken(),b=newShareToken();expect(validShareToken(a)).toBe(true);expect(a).not.toBe(b);expect(shareTokenHash(a)).toHaveLength(64);expect(shareTokenHash(a)).not.toBe(a);expect(shareTokenHash(a)).not.toBe(shareTokenHash(b));
 });
 it('creates 128-bit short identifiers while accepting existing links',()=>{const token=newShortShareToken();expect(token).toHaveLength(22);expect(validShareToken(token)).toBe(true);expect(token).not.toBe(newShortShareToken());expect(validShareToken(newShareToken())).toBe(true)})
 it('rejects match IDs, paths and malformed tokens',()=>{
  for(const token of ['', '../admin','311fc424-99af-49f9-9dad-37780b7f01b6','a'.repeat(42),'a'.repeat(44)])expect(validShareToken(token)).toBe(false);
 });
})

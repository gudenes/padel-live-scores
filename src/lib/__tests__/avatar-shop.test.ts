import {describe,it,expect} from 'vitest'
import {SHOP_ITEMS,SHOP_SLOTS,SHOP_AVATARS,initialShopState,purchaseItem,equipItem,parseShopState,wardrobeBody,gearArtwork} from '../avatar-shop'
describe('local shop preview',()=>{
 it('keeps a photo identity while equipping every wardrobe slot',()=>{
 const avatar='custom:12345678-1234-4234-8234-123456789abc' as const
 let state={...initialShopState(),avatar} as ReturnType<typeof initialShopState>
 for(const slot of SHOP_SLOTS.filter(s=>s.id!=='sticker'))state=purchaseItem(state,`${slot.id}-club`,0)
 expect(state.avatar).toBe(avatar)
 expect(parseShopState(JSON.stringify(state))).toEqual(state)
 expect(wardrobeBody(avatar)).toBe('face-06')
 expect(gearArtwork(avatar,'starter')).toContain('/api/play/avatar/image?id=')
 expect(gearArtwork(wardrobeBody(avatar),'club')).toBe('/play/avatars/swap-lab/alternate.webp')
 expect(wardrobeBody('face-02')).toBe('face-02')
 })
 it('restores all ten characters and valid photo avatars',()=>{expect(SHOP_AVATARS).toHaveLength(10);for(const a of SHOP_AVATARS)expect(parseShopState(JSON.stringify({...initialShopState(),avatar:a.id})).avatar).toBe(a.id);const avatar='custom:12345678-1234-4234-8234-123456789abc';expect(parseShopState(JSON.stringify({...initialShopState(),avatar})).avatar).toBe(avatar);expect(parseShopState(JSON.stringify({...initialShopState(),avatar:'custom:invalid'})).avatar).toBe('face-06')})
 it('has five gear choices, seven hats and two stickers',()=>{for(const slot of SHOP_SLOTS.filter(s=>s.id!=='sticker'))expect(SHOP_ITEMS.filter(i=>i.slot===slot.id)).toHaveLength(slot.id==='hat'?7:5);expect(SHOP_ITEMS.filter(i=>i.slot==='sticker')).toHaveLength(2)})
 it('charges once and owns and equips the purchased item',()=>{const a=purchaseItem(initialShopState(),'hat-club',0);expect(a.balance).toBe(8150);expect(a.equipped.hat).toBe('hat-club');expect(purchaseItem(a,'hat-club',0)).toEqual(a)})
 it('requires milestone AND payment',()=>{expect(()=>purchaseItem(initialShopState(),'shirt-champion',24)).toThrow();const a=purchaseItem(initialShopState(),'shirt-champion',25);expect(a.balance).toBe(7700);expect(()=>purchaseItem({...initialShopState(),balance:10},'shirt-champion',25)).toThrow()})
 it.each(['hat-backwards','hat-bandana'])('saves independent headwear %s for a photo avatar',id=>{
 const start={...initialShopState(),avatar:'custom:12345678-1234-4234-8234-123456789abc' as const}
 const next=purchaseItem(start,id,0)
 expect(parseShopState(JSON.stringify(next))).toEqual(next)
 expect(next.equipped.hat).toBe(id)
 expect(next.avatar).toBe(start.avatar)
 expect(SHOP_ITEMS.find(i=>i.id===id)?.headwear).toBeDefined()
 })
 it('cannot equip an unowned item',()=>expect(()=>equipItem(initialShopState(),'sticker-king')).toThrow())
 it('restores independent slots and rejects corrupt saves',()=>{let a=purchaseItem(initialShopState(),'hat-club',0);a=purchaseItem(a,'shirt-cobalt',0);expect(parseShopState(JSON.stringify(a))).toEqual(a);expect(parseShopState('bad')).toEqual(initialShopState());expect(parseShopState(JSON.stringify({...a,equipped:{hat:'shirt-cobalt'}})).equipped).toEqual({})})
})

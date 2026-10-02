import {SHOP_ITEMS, type ShopState} from './avatar-shop'
/** A01 artwork for saved Play wardrobes; access remains enforced by the Play routes. */
export function usesA01Artwork(avatar:string) {
 return /^face-(0[1-9]|10)$/.test(avatar)
}
export function a01Outfit(equipped:ShopState['equipped']):Record<string,string> {
 return Object.fromEntries(Object.entries(equipped).flatMap(([slot,id])=>{
  const item=SHOP_ITEMS.find(i=>i.id===id&&i.slot===slot)
  if(!item)return []
  return [[slot,id==='hat-backwards'?'backwards':id==='hat-bandana'?'bandana':slot==='sticker'?id.replace('sticker-',''):item.collection]]
 }))
}

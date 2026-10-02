import {SHOP_ITEMS, type ShopState} from './avatar-shop'
/** Approved A01 roster. Play access is enforced by the consuming pages and wardrobe APIs. */
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

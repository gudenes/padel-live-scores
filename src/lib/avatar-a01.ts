import {SHOP_ITEMS, type ShopState} from './avatar-shop'
/** Local art rollout; keep production artwork until every fitted combination is ready. */
export function usesA01Artwork(avatar:string) {
 return process.env.NODE_ENV==='development' && /^face-(0[1-9]|10)$/.test(avatar)
}
export function a01Outfit(equipped:ShopState['equipped']):Record<string,string> {
 return Object.fromEntries(Object.entries(equipped).flatMap(([slot,id])=>{
  const item=SHOP_ITEMS.find(i=>i.id===id&&i.slot===slot)
  if(!item)return []
  return [[slot,id==='hat-backwards'?'backwards':id==='hat-bandana'?'bandana':slot==='sticker'?id.replace('sticker-',''):item.collection]]
 }))
}

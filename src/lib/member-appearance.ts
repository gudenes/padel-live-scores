import {SHOP_AVATARS,SHOP_ITEMS,type ShopState} from './avatar-shop'
export type MemberAppearance=Pick<ShopState,'avatar'|'equipped'>
export function parseMemberAppearance(value:unknown):MemberAppearance|null {
 if(!value||typeof value!=='object')return null
 const {avatar,equipped}=value as Record<string,unknown>
 if(typeof avatar!=='string'||(!/^custom:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(avatar)&&!SHOP_AVATARS.some(a=>a.id===avatar)))return null
 return {avatar:avatar as MemberAppearance['avatar'],equipped:Object.fromEntries(Object.entries(equipped&&typeof equipped==='object'?equipped:{}).filter(([slot,id])=>SHOP_ITEMS.some(item=>item.id===id&&item.slot===slot)))}
}

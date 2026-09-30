import {PLAYER_FACES,parseOutfit} from './player-outfit'
/** Local fitting catalogue. Performance targets are preview values pending game rules. */
export const SHOP_AVATARS = PLAYER_FACES.map((id,i)=>({id,name:['Brisa','Nilo','Dara','Tano','Vera','Beltrán','Alexis','Ciro','Mika','Rocco'][i]}))
export type ShopAvatar = typeof PLAYER_FACES[number] | `custom:${string}`
export const SHOP_SLOTS = [
 {id:'racket',name:'Racket',path:'M65 650H310L335 880L340 948L405 980L402 1040L320 1030L265 970H65Z',crop:'55 650 365 405'},
 {id:'shoes',name:'Shoes',path:'M270 1200H845V1410H270Z',crop:'265 1190 580 230'},
 {id:'shorts',name:'Shorts',path:'M405 900H704L715 960L742 1060L720 1110H365V1040L395 960Z',crop:'370 920 370 185'},
 {id:'shirt',name:'T-shirt',path:'M450 560L610 560L690 620L755 780L700 805L706 908Q555 948 411 907L407 800L330 766L330 700L377 620Z',crop:'330 570 420 365'},
 {id:'wrist',name:'Wristband',path:'M704 877L777 847L801 914L731 944Z',crop:'695 840 115 110'},
 {id:'hat',name:'Hat',path:'M250 20H780V390H700V350H410V405H250Z',crop:'275 35 475 370'},
 {id:'sticker',name:'Stickers',path:'',crop:''},
] as const
export type ShopSlot = typeof SHOP_SLOTS[number]['id']
export const COLLECTIONS = ['starter','club','cobalt','sunset','champion'] as const
export type Collection = typeof COLLECTIONS[number]
export interface ShopItem {id:string;slot:ShopSlot;name:string;collection:Collection;price:number;wins:number;image?:string;headwear?:{x:number;y:number;width:number;height:number;transform?:string}}
const names: Record<Exclude<ShopSlot,'sticker'>,string[]> = {
 racket:['Starter','Lime Strike','Blue Bolt','Coral Smash','Golden Ace'],
 shoes:['Starter','Court Sprint','Blue Sprint','Sunset Step','Gold Rush'],
 shorts:['Starter','Deep Court','Midnight Club','Sand Court','Final Set'],
 shirt:['Starter','Orange Rally','Blue Rally','Coral Rally','Champion Tee'],
 wrist:['Starter','Match Point','Blue Focus','Coral Touch','Golden Touch'],
 hat:['Starter','Club Cap','Blue Visor','Sun Rally','Champion Cap'],
}
export const SHOP_ITEMS: ShopItem[] = SHOP_SLOTS.filter(s=>s.id!=='sticker').flatMap<ShopItem>(slot=>COLLECTIONS.map((collection,i)=>({id:`${slot.id}-${collection}`,slot:slot.id,name:names[slot.id as keyof typeof names][i],collection,price:[0,350,500,650,800][i],wins:[0,0,0,10,25][i]}))).concat([
 {id:'sticker-king',slot:'sticker',name:'King of Predict',collection:'champion',price:800,wins:25,image:'/play/avatars/shop/king.webp'},
 {id:'sticker-dejadas',slot:'sticker',name:'Mr. Dejadas',collection:'sunset',price:650,wins:10,image:'/play/avatars/shop/dejadas.webp'},
 {id:'hat-backwards',slot:'hat',name:'Reverse Rally',collection:'club',price:650,wins:0,image:'/play/avatars/shop/headwear/backwards-cap-v8.svg',headwear:{x:283,y:94,width:435,height:318}},
 {id:'hat-bandana',slot:'hat',name:'Court Bandana',collection:'sunset',price:550,wins:0,image:'/play/avatars/shop/headwear/bandana-v2.webp',headwear:{x:270,y:225,width:440,height:145,transform:'rotate(-5 530 290)'}},
] as ShopItem[])
// Tight headwear masks keep the catalogue character's face out of photo portraits.
export const PHOTO_HAT_PATHS:Record<Collection,string> = {
 starter:'',
 club:'M250 20H780V240H728Q706 160 610 160Q540 152 476 206Q402 273 363 256L311 301H250Z',
 cobalt:'M336 286Q321 228 430 159Q575 76 666 161L680 195Q730 218 732 255Q720 281 685 230Q621 173 541 209Q472 248 424 279Q393 293 373 272Z',
 sunset:'M332 300Q317 218 430 155Q562 83 657 148L670 175Q714 210 721 250Q719 270 702 259Q669 190 600 179Q545 174 488 219Q417 280 384 256Z',
 champion:'M250 20H780V233H715Q700 166 623 132Q540 110 480 168Q405 243 365 235L305 299H250Z',
}
export function wardrobeBody(avatar:ShopAvatar):ShopAvatar {
 return avatar.startsWith('custom:')?'face-06':avatar
}
export function gearArtwork(avatar:ShopAvatar, collection:Collection) {
 if(avatar.startsWith('custom:'))return `/api/play/avatar/image?id=${avatar.slice(7)}`
 if(collection==='starter')return `/play/avatars/${avatar}.webp`
 if(!['face-06','face-02','face-08'].includes(avatar))avatar='face-06'
 if(collection==='club')return `/play/avatars/swap-lab/${avatar==='face-06'?'alternate':avatar}.webp`
 return `/play/avatars/shop/${avatar}-${collection}.webp`
}
export interface ShopState {balance:number;owned:string[];equipped:Partial<Record<ShopSlot,string>>;avatar:ShopAvatar}
export function initialShopState():ShopState {return {balance:8500,owned:SHOP_ITEMS.filter(i=>i.price===0).map(i=>i.id),equipped:{},avatar:'face-06'}}
export function purchaseItem(state:ShopState,id:string,wins:number):ShopState {
 const item=SHOP_ITEMS.find(i=>i.id===id)
 if(!item)throw Error('Item unavailable')
 if(state.owned.includes(id))return state
 if(wins<item.wins)throw Error(`Requires ${item.wins} correct predictions`)
 if(state.balance<item.price)throw Error('Not enough Guacas')
 return {...state,balance:state.balance-item.price,owned:[...state.owned,id],equipped:{...state.equipped,[item.slot]:id}}
}
export function equipItem(state:ShopState,id:string):ShopState {
 const item=SHOP_ITEMS.find(i=>i.id===id)
 if(!item || !state.owned.includes(id))throw Error('Unlock this item first')
 return {...state,equipped:{...state.equipped,[item.slot]:id}}
}
export function parseShopState(raw:string|null):ShopState {
 if(!raw)return initialShopState()
 try {
 const value=JSON.parse(raw) as ShopState
 if(!Number.isSafeInteger(value.balance)||value.balance<0||!Array.isArray(value.owned)||!(SHOP_AVATARS.some(a=>a.id===value.avatar)||(typeof value.avatar==='string'&&value.avatar.startsWith('custom:')&&parseOutfit(value.avatar))))return initialShopState()
 const owned=Array.from(new Set([...initialShopState().owned,...value.owned.filter(id=>SHOP_ITEMS.some(i=>i.id===id))]))
 const equipped:ShopState['equipped']={}
 for(const slot of SHOP_SLOTS){const id=value.equipped?.[slot.id];if(id&&owned.includes(id)&&SHOP_ITEMS.some(i=>i.id===id&&i.slot===slot.id))equipped[slot.id]=id}
 return {balance:value.balance,owned,equipped,avatar:value.avatar}
 }catch{return initialShopState()}
}

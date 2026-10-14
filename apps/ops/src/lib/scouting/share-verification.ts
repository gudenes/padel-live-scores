import {createHmac,randomInt,timingSafeEqual} from 'node:crypto'
export function normalizeShareEmail(value:unknown){
 if(typeof value!=='string')return null
 const email=value.trim().toLowerCase();return email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null
}
export const newShareCode=()=>String(randomInt(0,1000000)).padStart(6,'0')
export function shareDigest(value:string){
 const secret=process.env.AUTH_SECRET
 if(!secret)throw Error('Verification is not configured.')
 return createHmac('sha256',secret).update(value).digest('hex')
}
export const codeDigest=(id:string,code:string)=>shareDigest('report-code:'+id+':'+code)
export function matchesCode(id:string,code:string,hash:string){
 if(!/^\d{6}$/.test(code)||!/^[a-f0-9]{64}$/.test(hash))return false
 return timingSafeEqual(Buffer.from(codeDigest(id,code),'hex'),Buffer.from(hash,'hex'))
}
export const visitorCookie=(shareHash:string)=>'report_view_'+shareHash.slice(0,16)

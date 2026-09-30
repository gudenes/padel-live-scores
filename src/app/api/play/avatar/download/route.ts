import {requirePlayAccess} from '@/lib/play-access'
import {isTrustedPlayWrite} from '@/lib/play-write-origin'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const MAX_BYTES=6*1024*1024
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
// A standard attachment response works in browsers that cannot download blob URLs.
// The image is returned immediately; no photo or export is saved on the server.
export async function POST(req:Request){
 if(!await requirePlayAccess())return new Response(null,{status:404,headers})
 if(!isTrustedPlayWrite(req,'application/x-www-form-urlencoded'))return new Response(null,{status:403,headers})
 const reader=req.body?.getReader();if(!reader)return new Response(null,{status:400,headers})
 const chunks:Uint8Array[]=[];let size=0
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();return new Response(null,{status:413,headers})}chunks.push(value)}
 const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
 const image=form.get('image')??''
 if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image))return new Response(null,{status:400,headers})
 const bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64')
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return new Response(null,{status:400,headers})
 const format=form.get('format')==='portrait'?'portrait':'full'
 return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png','Content-Disposition':`${new URL(req.url).searchParams.get('display')==='inline'?'inline':'attachment'}; filename="padel-nachos-${format}.png"`,'Content-Length':String(bytes.length)}})
}

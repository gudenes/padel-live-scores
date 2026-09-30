export type AvatarShareFormat = 'portrait' | 'full'
export type AvatarShareBackground = 'court' | 'transparent'

/** Clear only the edge-connected compositing backdrop, preserving dark interior details. */
export function clearAvatarBackdrop(pixels: Uint8ClampedArray, width: number, height: number) {
  const seen = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let start = 0, end = 0
  const visit = (index: number) => {
    if (seen[index]) return
    seen[index] = 1
    const p = index * 4
    if (Math.abs(pixels[p] - 36) > 4 || Math.abs(pixels[p+1] - 37) > 4 || Math.abs(pixels[p+2] - 32) > 4) return
    queue[end++] = index
  }
  for (let x=0;x<width;x++) { visit(x); visit((height-1)*width+x) }
  for (let y=0;y<height;y++) { visit(y*width); visit(y*width+width-1) }
  while (start < end) {
    const index=queue[start++], x=index%width, y=Math.floor(index/width)
    pixels[index*4+3]=0
    if(x>0)visit(index-1)
    if(x<width-1)visit(index+1)
    if(y>0)visit(index-width)
    if(y<height-1)visit(index+width)
  }
}

type ExportCache = {markup:string; artwork:Promise<HTMLCanvasElement>; files:Map<string,Promise<File>>}
// Scoped to the rendered SVG: changes to clothes invalidate the result and
// unmounting the avatar allows both its pixels and private photo to be collected.
const exportsByAvatar = new WeakMap<SVGSVGElement,ExportCache>()

async function renderArtwork(svg:SVGSVGElement):Promise<HTMLCanvasElement> {
  const clone=svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg')
  clone.setAttribute('width','720');clone.setAttribute('height','1080')
  clone.removeAttribute('class');clone.removeAttribute('style')
  const sources=new Map<string,Promise<string>>()
  await Promise.all(Array.from(clone.querySelectorAll('image')).map(async image=>{
    const href=image.getAttribute('href')
    if(!href)return
    let source=sources.get(href)
    if(!source){
      source=(async()=>{
        const response=await fetch(href,{signal:AbortSignal.timeout(15000),...(href.startsWith('/play/')?{cache:'force-cache' as const}:{})})
        if(!response.ok)throw new Error('Image unavailable')
        const blob=await response.blob()
        return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)})
      })()
      sources.set(href,source)
    }
    image.setAttribute('href',await source)
  }))
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}))
  try{
    const image=new Image();image.src=url;await image.decode()
    const artwork=document.createElement('canvas');artwork.width=720;artwork.height=1080
    const art=artwork.getContext('2d',{willReadFrequently:true})
    if(!art)throw new Error('Image export unavailable')
    art.fillStyle='#242520';art.fillRect(0,0,720,1080);art.globalCompositeOperation='lighten';art.drawImage(image,0,0,720,1080)
    const pixels=art.getImageData(0,0,720,1080);clearAvatarBackdrop(pixels.data,720,1080);art.putImageData(pixels,0,0)
    return artwork
  }finally{URL.revokeObjectURL(url)}
}
let logoPromise:Promise<HTMLImageElement>|undefined
function loadLogo(){
  if(!logoPromise)logoPromise=(async()=>{const image=new Image();image.src='/padelnachos-logo-v2.png';await image.decode();return image})().catch(error=>{logoPromise=undefined;throw error})
  return logoPromise
}
let courtPromise:Promise<HTMLImageElement>|undefined
function loadCourt(){
  if(!courtPromise)courtPromise=(async()=>{const image=new Image();image.src='/play/avatars/backgrounds/sage-court-v1.png';await image.decode();return image})().catch(error=>{courtPromise=undefined;throw error})
  return courtPromise
}
async function composeFile(artworkPromise:Promise<HTMLCanvasElement>,format:AvatarShareFormat,background:AvatarShareBackground){
  const [artwork,logo]=await Promise.all([artworkPromise,loadLogo()])
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=format==='portrait'?1080:1440
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export unavailable')
  if(background==='court'){const court=await loadCourt();ctx.drawImage(court,0,0,1080,canvas.height)}
  if(format==='portrait')ctx.drawImage(artwork,190,30,410,440,225,100,630,676)
  else ctx.drawImage(artwork,120,20,840,1260)
  const width=152,height=width*914/1846,x=format==='portrait'?770:884,bottom=format==='portrait'?780:1200
  ctx.drawImage(logo,56,244,1846,914,x,bottom-height,width,height)
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Export failed')),'image/png'))
  return new File([blob],`padel-nachos-${format}.png`,{type:'image/png'})
}
/** Reuse the image until the equipped avatar actually changes. */
export function avatarShareFile(svg:SVGSVGElement,format:AvatarShareFormat='full',background:AvatarShareBackground='court'):Promise<File>{
  const markup=svg.outerHTML
  let entry=exportsByAvatar.get(svg)
  if(!entry||entry.markup!==markup){
    entry={markup,artwork:renderArtwork(svg),files:new Map()};exportsByAvatar.set(svg,entry)
  }
  const key=`${format}:${background}`
  const cached=entry.files.get(key);if(cached)return cached
  const current=entry
  const file=composeFile(entry.artwork,format,background).catch(error=>{if(exportsByAvatar.get(svg)===current)exportsByAvatar.delete(svg);throw error})
  entry.files.set(key,file)
  return file
}

import {Capacitor} from '@capacitor/core'
import {Share} from '@capacitor/share'
import {Directory,Filesystem} from '@capacitor/filesystem'

export class AvatarShareUpdateRequired extends Error {}

/** The native share sheet needs a device file URI, not a browser blob URL. */
export async function shareAvatarFile(file:File,dataUrl:string){
  if(Capacitor.isNativePlatform()){
    if(!Capacitor.isPluginAvailable('Filesystem'))throw new AvatarShareUpdateRequired()
    // Bounded cache: one image per export format; never stored in the photo library.
    const path=file.name==='padel-nachos-portrait.png'?'avatar-share/portrait.png':'avatar-share/full.png'
    const {uri}=await Filesystem.writeFile({path,directory:Directory.Cache,data:dataUrl.slice(dataUrl.indexOf(',')+1),recursive:true})
    await Share.share({files:[uri],title:'Padel Nachos',dialogTitle:'Share avatar'})
    // Keep the cached file alive for receiving apps that read it after the sheet closes.
    return
  }
  if(typeof navigator.share!=='function')throw new Error('Sharing unavailable')
  // Call directly while the user's tap is active; the PNG is already prepared.
  await navigator.share({files:[file],title:'Padel Nachos'})
}
export function isAvatarShareCancelled(error:unknown){
  if(!error||typeof error!=='object')return false
  const detail=error as {name?:string;message?:string}
  return detail.name==='AbortError'||/cancel(?:led|ed)?/i.test(detail.message??'')
}

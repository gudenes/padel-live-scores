import {notFound} from 'next/navigation'
import AvatarShop from '@/components/player/shop/AvatarShop'
/** Standalone local fitting route. The real shop retains its whitelist gate. */
export default function AvatarPreviewPage(){
 if(process.env.NODE_ENV!=='development')notFound()
 return <AvatarShop/>
}

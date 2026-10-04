import {notFound} from 'next/navigation'
import AvatarShop from '@/components/player/shop/AvatarShop'
export default function Page(){if(process.env.NODE_ENV==='production')notFound();return <AvatarShop guidePreview/>}

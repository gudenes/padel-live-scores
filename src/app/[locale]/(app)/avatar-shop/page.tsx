import {notFound} from 'next/navigation'
import {requirePlayAccess} from '@/lib/play-access'
import AvatarShop from '@/components/player/shop/AvatarShop'
export const dynamic='force-dynamic'
export default async function AvatarShopPage(){if(!await requirePlayAccess())notFound();return <AvatarShop/>}

import {requirePlayAccess} from '@/lib/play-access'
import BetaPage from './BetaPage'
import LegacyPage from './LegacyPage'
export const dynamic='force-dynamic'
export default async function Page(){return await requirePlayAccess()?<BetaPage/>:<LegacyPage/>}

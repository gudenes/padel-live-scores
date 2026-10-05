'use client'
import {useRouter} from '@/i18n/navigation'
import InviteDrawer from './InviteDrawer'
export default function InvitePage({preview=false}:{preview?:boolean}){
 const router=useRouter()
 return <InviteDrawer preview={preview} onClose={()=>router.replace('/play?view=leaders')}/>
}

import {notFound} from 'next/navigation'
import {invitationWindow} from '@/lib/play-invites'
import {requirePlayAccess} from '@/lib/play-access'
import InvitePage from '@/components/play-invite/InvitePage'
export default async function Page(){
 if (!await requirePlayAccess()) notFound()
 return <InvitePage preview={process.env.NODE_ENV !== 'production' && !invitationWindow()}/>
}

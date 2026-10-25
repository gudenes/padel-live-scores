import {ScoutingNavigation} from '@/components/scouting/ScoutingNavigation'
import { auth } from '@/lib/auth'
import { canViewReports } from '@/lib/scouting-permissions'
import { redirect } from 'next/navigation'
import {PlayerDrawerProvider} from '@/components/player-drawer-context'
import {PlayerDrawerHost} from '@/components/PlayerDrawerHost'
import { AppShell } from '@/components/shell/AppShell'
export default async function Layout({children}:{children:React.ReactNode}) {
 const user=(await auth())?.user
 if(!user)redirect('/login')
 if(!canViewReports(user))redirect('/not-authorized')
 if(user.isOperator)return <PlayerDrawerProvider><AppShell userEmail={user.email}><ScoutingNavigation userId={user.id??''}>{children}</ScoutingNavigation></AppShell><PlayerDrawerHost/></PlayerDrawerProvider>
 return <AppShell userEmail={user.email} scoped><ScoutingNavigation userId={user.id??''}>{children}</ScoutingNavigation></AppShell>
}

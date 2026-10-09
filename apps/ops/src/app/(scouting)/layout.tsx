import Link from 'next/link'
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
 if(user.isOperator)return <PlayerDrawerProvider><AppShell userEmail={user.email}>{children}</AppShell><PlayerDrawerHost/></PlayerDrawerProvider>
 return <div><nav style={{display:'flex',gap:24,padding:20,borderBottom:'1px solid var(--border)',alignItems:'center'}}><strong>Padel Nachos · Scouting</strong><Link href="/scouting">All scouted matches</Link><Link href="/scouting/methodology">Methodology</Link><span style={{marginLeft:'auto'}}>{user.email}</span><Link href="/api/auth/signout">Sign out</Link></nav>{children}</div>
}

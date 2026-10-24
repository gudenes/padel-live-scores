import {Suspense} from 'react'
import {auth} from '@/lib/auth'
import Intelligence from './Intelligence'
export const metadata={title:'Player intelligence · PadelNachos Admin'}
export default async function Page(){const user=(await auth())?.user;return <Suspense fallback={<p role="status">Loading player intelligence…</p>}><Intelligence userId={user?.id??''}/></Suspense>}

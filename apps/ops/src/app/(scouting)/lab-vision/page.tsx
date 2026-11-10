import {auth} from '@/lib/auth'
import {notFound,redirect} from 'next/navigation'
import Workspace from './workspace'
export default async function Page(){if(process.env.NODE_ENV!=='development')notFound();if(!(await auth())?.user?.isOperator)redirect('/not-authorized');return <Workspace/>}

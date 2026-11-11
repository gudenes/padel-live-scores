import {auth} from '@/lib/auth'
import {redirect} from 'next/navigation'
import Workspace from './workspace'
export default async function Page(){if(!(await auth())?.user?.isOperator)redirect('/not-authorized');return <Workspace/>}

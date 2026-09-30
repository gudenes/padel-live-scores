import {notFound} from 'next/navigation'
import Matrix from './matrix'
export default function Page(){if(process.env.NODE_ENV!=='development')notFound();return <Matrix/>}

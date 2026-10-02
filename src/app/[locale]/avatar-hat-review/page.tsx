import {notFound} from 'next/navigation'
import HatReview from './review'
export default function Page(){
 if(process.env.NODE_ENV!=='development')notFound()
 return <HatReview/>
}

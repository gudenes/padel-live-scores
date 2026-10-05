import {notFound} from 'next/navigation'
import InviteReview from '@/components/play-invite/InviteReview'
export default function Page(){
 if(process.env.NODE_ENV === 'production') notFound()
 return <InviteReview/>
}

import {notFound} from 'next/navigation'
import OnboardingReview from './review'
export default function Page(){
 if(process.env.NODE_ENV==='production')notFound()
 return <OnboardingReview/>
}

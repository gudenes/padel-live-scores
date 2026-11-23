import {notFound} from 'next/navigation'
import JoystickReview from '@/components/nav/JoystickReview'

export default function Page(){
 if(process.env.NODE_ENV==='production')notFound()
 return <JoystickReview/>
}

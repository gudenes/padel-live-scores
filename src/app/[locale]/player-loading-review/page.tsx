import {notFound} from 'next/navigation'
import PlayerLoading from '../(app)/play/_components/PlayerLoading'
import BottomNavV3 from '@/components/nav/BottomNavV3'
export default function PlayerLoadingReview(){
 if(process.env.NODE_ENV==='production')notFound()
 return <><PlayerLoading/><BottomNavV3/></>
}

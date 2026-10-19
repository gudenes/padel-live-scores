import {auth} from '@/lib/auth'
import {redirect} from 'next/navigation'
import {createServiceClient} from '@/lib/supabase'
import Academy from './Academy'
export const metadata={title:'Scout Academy · Padel Labs'}
export default async function Page(){
 const user=(await auth())?.user
 if(!user)redirect('/login')
 let videoUrl=process.env.SCOUT_TRAINING_VIDEO_URL
 if(!videoUrl&&process.env.NODE_ENV==='production'){
  const {data,error}=await createServiceClient().storage.from('scout-training').createSignedUrl('milano-opening-20min.mp4',14400)
  if(error||!data?.signedUrl)throw new Error('Training video is temporarily unavailable. Please try again later.')
  videoUrl=data.signedUrl
 }
 return <Academy videoUrl={videoUrl || '/training-media/milano.mp4'} storageKey={`scout-academy:milano-v1:${user.id}`}/>
}

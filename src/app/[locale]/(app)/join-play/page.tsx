import type {Metadata} from 'next'
import {getTranslations} from 'next-intl/server'
import InviteExperience from '@/components/play-invite/InviteExperience'
export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{
 const {locale}=await params
 const t=await getTranslations({locale,namespace:'play.invite'})
 return {title:'Padel Predict · Padel Nachos',description:t('receiveBody'),robots:{index:false,follow:false},openGraph:{title:t('title'),description:t('shareText'),images:[{url:'https://padelnachos.com/play/invite/friends-hero-v1.webp',width:1448,height:1086,alt:t('artAlt')}]}}
}
export default function Page(){return <InviteExperience mode="receive"/>}

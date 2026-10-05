'use client'
import {useState} from 'react'
import {useTranslations} from 'next-intl'
import {useSearchParams} from 'next/navigation'
import {Press} from '@/app/[locale]/(app)/play/_components/shared'
import InviteDrawer from './InviteDrawer'
import InviteExperience from './InviteExperience'
export default function InviteReview(){
 const [open,setOpen]=useState(true),t=useTranslations('play.invite'),params=useSearchParams()
 if(params.get('received')==='1')return <InviteExperience mode="receive" preview/>
 return <div style={{minHeight:'85dvh',padding:'32px 24px',background:'#191919'}}><Press onClick={()=>setOpen(true)}>{t('inviteFriends')}</Press>{open&&<InviteDrawer preview onClose={()=>setOpen(false)}/>}</div>
}

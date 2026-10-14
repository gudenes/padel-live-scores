import {cookies} from 'next/headers'
import EmailGate from './EmailGate'
import {visitorCookie} from '@/lib/scouting/share-verification'
import {notFound} from 'next/navigation'
import {pgPool} from '@/lib/db'
import {validShareToken,shareTokenHash} from '@/lib/scouting/share-token'
import SharedReport from './SharedReport'
export const dynamic='force-dynamic'
export const metadata={title:'Shared match analysis · Padel Labs',robots:{index:false,follow:false},referrer:'no-referrer'}
export default async function Page({params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!validShareToken(token))notFound()
 const result=await pgPool().query('select token_hash from scouting_report_shares where token_hash=$1 and revoked_at is null and expires_at>now()',[shareTokenHash(token)])
 if(!result.rows[0])notFound()
 const share=shareTokenHash(token),cookie=(await cookies()).get(visitorCookie(share))?.value
 if(!cookie||!validShareToken(cookie))return <EmailGate token={token}/>
 const visitor=await pgPool().query('select email from report_share_visitors where session_hash=$1 and share_hash=$2 and expires_at>now()',[shareTokenHash(cookie),share])
 if(!visitor.rows[0])return <EmailGate token={token}/>
 const report=await pgPool().query('select snapshot from scouting_report_shares where token_hash=$1 and revoked_at is null and expires_at>now()',[share])
 if(!report.rows[0])notFound()
 await pgPool().query("insert into report_share_activity(share_hash,email,event) values($1,$2,'report_viewed')",[share,visitor.rows[0].email])
 return <SharedReport data={report.rows[0].snapshot}/>
}

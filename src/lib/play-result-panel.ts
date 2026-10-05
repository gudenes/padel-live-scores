import type {PlayPosition} from '@/app/[locale]/(app)/play/_components/types'
export interface ResultNotification {id:string;metadata:{market_id?:string;revision?:number;delta?:number}|null;created_at:string}
export interface ResultPanelData {id:string;marketId:string;question:string;match:string|null;context:string;side:string;kind:'won'|'lost'|'refunded'|'corrected'|'mixed';paid:number;cost:number;delta:number}
/** Only join final positions. Never infer a win from the wallet delta (losses credit zero). */
export function resultPanelData(notice:ResultNotification,positions:PlayPosition[]):ResultPanelData|null {
 const rows=positions.filter(p=>p.marketId===notice.metadata?.market_id)
 if(!rows.length||rows.some(p=>!['won','lost','refunded'].includes(p.result??'')||!['settled','void'].includes(p.status)))return null
 const revision=Number(notice.metadata?.revision??1)
 // A previous notification must not describe a newer corrected payout.
 if(rows.some(p=>p.corrected)&&revision<=1)return null
 const paid=rows.reduce((n,p)=>n+p.valueNow,0),cost=rows.reduce((n,p)=>n+p.costBasis,0)
 const delta=Number(notice.metadata?.delta)
 if(!Number.isFinite(delta))return null
 return {id:notice.id,marketId:rows[0].marketId,question:rows[0].question,match:rows[0].matchLabel??null,context:rows[0].context,side:rows.length===1?rows[0].side:'both',kind:revision>1?'corrected':rows.length>1?'mixed':rows[0].result as 'won'|'lost'|'refunded',paid,cost,delta}
}

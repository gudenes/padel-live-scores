import type {Person,Summary} from './model'
export const sortColumns = {
 name:{label:'Player name',direction:'asc'}, rank:{label:'Current rank',direction:'asc'},
 matches:{label:'Total matches',direction:'desc'}, scouted:{label:'Scouted matches',direction:'desc'},
 form:{label:'Recent form',direction:'desc'}, record:{label:'Scouted win rate',direction:'desc'},
 impact:{label:'Average impact',direction:'desc'}, winners:{label:'Winners / 100',direction:'desc'},
 unforced:{label:'UE / 100',direction:'asc'}, smash:{label:'Smash conversion',direction:'desc'},
} as const
export type SortKey=keyof typeof sortColumns
export function parseDirectorySort(value:string){
 const [raw,direction]=value.split(':')
 const key:SortKey=Object.hasOwn(sortColumns,raw)?raw as SortKey:'scouted'
 return {key,direction:direction==='asc'||direction==='desc'?direction:sortColumns[key].direction}
}
export function validDirectorySort(value:string){const [key,direction,...extra]=value.split(':');return Object.hasOwn(sortColumns,key)&&!extra.length&&(!direction||direction==='asc'||direction==='desc')}
export function compareValues(a:string|number|null,b:string|number|null,direction:string){
 if(a===null)return b===null?0:1
 if(b===null)return -1
 return (typeof a==='string'&&typeof b==='string'?a.localeCompare(b):Number(a)-Number(b))*(direction==='asc'?1:-1)
}
export function directorySortValue(key:SortKey,people:Person[],s:Summary,total:number,recent:boolean[]):string|number|null{
 const ratio=(a:number,b:number)=>b?a/b:null
 switch(key){
 case 'name':return people.map(p=>p.name).join(' / ')
 case 'rank':return people.every(p=>p.ranking&&p.ranking>0)?people.reduce((n,p)=>n+p.ranking!,0):null
 case 'matches':return total
 case 'scouted':return s.matches
 case 'form':return ratio(recent.filter(Boolean).length,recent.length)
 case 'record':return ratio(s.wins,s.wins+s.losses)
 case 'impact':return ratio(s.impact,s.matches)
 case 'winners':return ratio(s.winners,s.points)
 case 'unforced':return ratio(s.unforced,s.points)
 case 'smash':return ratio(s.smashWinners,s.smashes)
 }
}

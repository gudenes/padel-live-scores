import {ADMIN_ORIGIN} from './account.mjs';
export function adminReportUrl(selectedMatch){
 if(!selectedMatch?.id)return null;
 return `${ADMIN_ORIGIN}/scouting/${selectedMatch.kind==='manual'?'manual/':''}${encodeURIComponent(selectedMatch.id)}/report`;
}

export function adminReportUrl(m){return m?.id?'/scouting/'+encodeURIComponent(m.id)+'/report'+(new URL(location.href).searchParams.get('liveLab')==='1'?'?liveReview=1':''):null;}

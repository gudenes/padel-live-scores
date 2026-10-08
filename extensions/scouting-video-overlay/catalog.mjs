// Uses the operator session directly from the worker; legacy injection remains testable.
// Only these two read-only, same-origin endpoints are allowed.
export async function readAdminCatalog(request, connection=null){
 if(!connection&&location.origin!=='https://admin.padelnachos.com')throw Error('Open admin.padelnachos.com in Chrome, sign in, then click the extension icon there.');
 if(request.kind==='scouting-matches'){const params=new URLSearchParams();for(const key of ['start','end','q'])if(request[key])params.set(key,request[key]);const response=await fetch((connection?.origin??'')+'/api/internal/scouting-catalog?'+params,{credentials:connection?'include':'same-origin',cache:'no-store'});let data;try{data=await response.json()}catch{throw Error('Today’s match search requires the admin update. Your saved scouting is unchanged.')}if(!response.ok)throw Error(data.error??'Match search unavailable. Update admin and retry.');return data;}
 let path='/api/internal/tournament-explorer';
 if(request.kind==='matches'){
  if(!/^[0-9a-f-]{36}$/i.test(request.tournamentId??''))throw Error('Invalid tournament ID.');
  path='/api/internal/tournament-matches?tournament_id='+encodeURIComponent(request.tournamentId);
 }else if(request.kind!=='tournaments')throw Error('Unsupported catalogue request.');
 else if(request.year){
  if(!/^20\d{2}$/.test(String(request.year)))throw Error('Choose a valid year.');
  path+='?from='+request.year+'-01-01&to='+request.year+'-12-31';
 }
 const response=await fetch((connection?.origin??'')+path,{credentials:connection?'include':'same-origin',cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in to admin as an operator, then load tournaments again.':'Admin could not load the catalogue. Try again.');
 const data=await response.json();
 if(request.kind==='tournaments')return {tournaments:(data.tournaments??[]).map(t=>({id:t.id,name:t.name,level:t.level,country:t.country,location:t.location,startsAt:t.starts_at,endsAt:t.ends_at})),loadedAt:new Date().toISOString()};
 return {tournamentId:request.tournamentId,matches:(data.matches??[]).filter(m=>m.linkedMatchId).map(m=>({id:m.linkedMatchId,tournamentId:request.tournamentId,names:[m.team1Player1?.name??m.team1Player1Name,m.team1Player2?.name??m.team1Player2Name,m.team2Player1?.name??m.team2Player1Name,m.team2Player2?.name??m.team2Player2Name],playerIds:[m.team1Player1?.id,m.team1Player2?.id,m.team2Player1?.id,m.team2Player2?.id],scheduledAt:m.scheduledAt??null,matchDate:m.matchDate??data.dayDates?.[m.dayNumber]??null,players:[m.team1Player1,m.team1Player2,m.team2Player1,m.team2Player2].map(p=>({side:p?.side??null,country:typeof p?.country==='string'?p.country:null,ranking:Number.isSafeInteger(p?.ranking)&&p.ranking>0?p.ranking:null})),category:m.category,round:m.roundLabel,status:m.status})).filter(m=>m.names.every(n=>typeof n==='string'&&n.trim())),loadedAt:new Date().toISOString()};
}

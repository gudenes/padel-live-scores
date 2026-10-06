// Runs inside the explicitly connected admin tab, using its existing operator login.
// Only these two read-only, same-origin endpoints are allowed.
export async function readAdminCatalog(request){
 if(location.origin!=='https://admin.padelnachos.com')throw Error('Open admin.padelnachos.com in Chrome, sign in, then click the extension icon there.');
 let path='/api/internal/tournament-explorer';
 if(request.kind==='matches'){
  if(!/^[0-9a-f-]{36}$/i.test(request.tournamentId??''))throw Error('Invalid tournament ID.');
  path='/api/internal/tournament-matches?tournament_id='+encodeURIComponent(request.tournamentId);
 }else if(request.kind!=='tournaments')throw Error('Unsupported catalogue request.');
 else if(request.year){
  if(!/^20\d{2}$/.test(String(request.year)))throw Error('Choose a valid year.');
  path+='?from='+request.year+'-01-01&to='+request.year+'-12-31';
 }
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in to admin as an operator, then load tournaments again.':'Admin could not load the catalogue. Try again.');
 const data=await response.json();
 if(request.kind==='tournaments')return {tournaments:(data.tournaments??[]).map(t=>({id:t.id,name:t.name,level:t.level,country:t.country,location:t.location,startsAt:t.starts_at,endsAt:t.ends_at})),loadedAt:new Date().toISOString()};
 return {tournamentId:request.tournamentId,matches:(data.matches??[]).filter(m=>m.linkedMatchId).map(m=>({id:m.linkedMatchId,tournamentId:request.tournamentId,names:[m.team1Player1?.name??m.team1Player1Name,m.team1Player2?.name??m.team1Player2Name,m.team2Player1?.name??m.team2Player1Name,m.team2Player2?.name??m.team2Player2Name],playerIds:[m.team1Player1?.id,m.team1Player2?.id,m.team2Player1?.id,m.team2Player2?.id],category:m.category,round:m.roundLabel,status:m.status})).filter(m=>m.names.every(n=>typeof n==='string'&&n.trim())),loadedAt:new Date().toISOString()};
}

export const matchUuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function manualInput(input){
 if(!input||!Array.isArray(input.players)||input.players.length!==4)throw Error('Enter four player names.');
 const players=input.players.map(p=>{
  const name=typeof p?.name==='string'?p.name.trim().replace(/\s+/g,' '):'';
  if(!name||name.length>80)throw Error('Each player needs a name of up to 80 characters.');
  if(p.id&&!matchUuid.test(p.id))throw Error('Choose a valid existing player.');
  return {name,id:p.id||null};
 });
 const names=players.map(p=>p.name.normalize('NFKC').toLocaleLowerCase());
 if(new Set(names).size!==4||new Set(players.filter(p=>p.id).map(p=>p.id)).size!==players.filter(p=>p.id).length)throw Error('Choose four different players.');
 const matchDate=input.matchDate||null;
 if(matchDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||Number.isNaN(Date.parse(matchDate))||new Date(matchDate).toISOString().slice(0,10)!==matchDate))throw Error('Choose a valid match date.');
 const tournamentLabel=String(input.tournamentLabel??'').trim();
 if(tournamentLabel.length>160)throw Error('Keep the tournament label under 160 characters.');
 let videoUrl=String(input.videoUrl??'').trim();
 if(videoUrl){let url;try{url=new URL(videoUrl);}catch{throw Error('Enter a valid video link.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||videoUrl.length>2000)throw Error('Enter an HTTP or HTTPS video link.');videoUrl=url.href;}
 return {players,matchDate,tournamentLabel,videoUrl};
}
export function manualDescriptor(row){
 return {id:row.id,kind:'manual',names:row.players.map(p=>p.name),playerIds:row.players.map(p=>p.id),players:row.players.map(p=>({country:p.country??null,ranking:p.ranking??null,side:p.side??null})),tournamentName:row.tournament_label||'Private scouting',round:'Manually created',matchDate:row.match_date,videoUrl:row.video_url||'',createdAt:row.created_at};
}

// Match-specific observations; never modify permanent player/coach links.
export function validateCoachConfirmations(value){
 if(!Array.isArray(value)||value.length!==2)throw Error('Review the coach for each team.');
 return value.map(entry=>{
  if(entry===null)return null;
  if(!entry||!['unknown','confirmed'].includes(entry.status)||!Array.isArray(entry.coaches)||entry.coaches.length>1)throw Error('Invalid coach confirmation.');
  if(entry.status==='unknown'&&entry.coaches.length||entry.status==='confirmed'&&!entry.coaches.length)throw Error('Choose a coach or I don’t know.');
  const ids=new Set();
  return {status:entry.status,coaches:entry.coaches.map(c=>{
   if(!c||typeof c.id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>160)throw Error('Invalid coach.');
   ids.add(c.id);return {id:c.id,name:c.name.trim()};
  })};
 });
}

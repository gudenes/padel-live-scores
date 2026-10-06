// Scouting is operator-only. Retain a closed route so existing public links cannot expose saved observations.
export const dynamic='force-dynamic'
export function GET(){
 return Response.json({error:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}})
}

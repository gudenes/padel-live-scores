import { auth } from '@/lib/auth'
import { archiveFilters,readWorldCupArchive } from '@/lib/world-cup-history'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  const session=await auth()
  if(!session?.user?.isOperator)return Response.json({error:'unauthorized'},{status:401})
  let filters:ReturnType<typeof archiveFilters>
  try {filters=archiveFilters(new URL(request.url).searchParams)}catch{return Response.json({error:'Invalid archive filters'},{status:400})}
  const data=await readWorldCupArchive(filters,true)
  return Response.json(data,{headers:{'Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="world-cup-${filters.year}.json"`}})
}

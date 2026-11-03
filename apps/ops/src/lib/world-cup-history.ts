import { pgPool } from './db'
export const archiveKinds = ['podium','squad','group','tie','match','replay','document'] as const
export function archiveFilters(params: URLSearchParams) {
  const year=Number(params.get('year')||2024)
  const kind=params.get('kind')||''
  const category=params.get('category')||''
  const page=Number(params.get('page')||1)
  if(!Number.isInteger(year)||year<1992||year>2024)throw new Error('Invalid edition')
  if(kind&&!archiveKinds.includes(kind as typeof archiveKinds[number]))throw new Error('Invalid record type')
  if(category&&!['men','women','mixed'].includes(category))throw new Error('Invalid category')
  if(!Number.isInteger(page)||page<1||page>10000)throw new Error('Invalid page')
  return {year,kind,category,page}
}
export async function readWorldCupArchive(filters: ReturnType<typeof archiveFilters>, download=false) {
  const db=pgPool()
  const editions=await db.query('select year,name,coverage,imported_at from world_cup_archive_editions order by year desc')
  const values=[filters.year,filters.kind,filters.category]
  const where="r.edition_year=$1 and ($2='' or r.kind=$2) and ($3='' or r.category=$3)"
  const count=await db.query(`select count(*)::int as total from world_cup_archive_records r where ${where}`,values)
  const records=await db.query(`select r.*,s.url as source_url,s.content_sha256,s.fetched_at from world_cup_archive_records r join world_cup_archive_sources s on s.id=r.source_id where ${where} order by r.kind,r.category,r.external_id limit $4 offset $5`,[...values,download?10000:50,download?0:(filters.page-1)*50])
  return {editions:editions.rows,records:records.rows,total:count.rows[0].total as number}
}

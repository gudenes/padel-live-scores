import {notFound, redirect} from 'next/navigation'
import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {previewBirthplace, type PreviewPlayer} from '@/lib/scouting/intelligence/birthplace-preview'
import Preview from './Preview'
export const dynamic = 'force-dynamic'
export const metadata = {title: 'Birthplace normalization preview · PadelNachos Admin'}
export default async function Page() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const user = (await auth())?.user
  if (!user) redirect('/login')
  if (!user.isOperator) notFound()
  const client = await pgPool().connect()
  try {
    await client.query('BEGIN READ ONLY')
    const result = await client.query<PreviewPlayer>(`select id, coalesce(nullif(display_name,''),name) as name, country, birthplace, ranking, profile_status from players order by ranking nulls last, name, id`)
    await client.query('ROLLBACK')
    return <Preview rows={result.rows.map(previewBirthplace)} loadedAt={new Date().toISOString()}/>
  } finally {
    // A failed query must not leave a transaction on a pooled connection.
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

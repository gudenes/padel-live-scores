import { loadAllCourts } from '@/lib/padelgenius/court-loader'
import { CourtCard } from './_components/CourtCard'
import { UploadCourtDropzone } from './_components/UploadCourtDropzone'

export const dynamic = 'force-dynamic'

export default async function CourtsLibraryPage() {
  const courts = await loadAllCourts()
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#e2e8f0', padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: '#fde047', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>Courts · {courts.length}</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>PadelGenius courts</h1>
        </div>
        <UploadCourtDropzone />
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {courts.map(c => <CourtCard key={c.slug} slug={c.slug} config={c.config} />)}
      </div>
    </div>
  )
}

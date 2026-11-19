'use client'
import {useState} from 'react'
import Link from 'next/link'
import {catalogueSource, catalunyaProvinces, normalizePlace, previewLabels, summarizePreview, type PreviewResult, type PreviewStatus} from '@/lib/scouting/intelligence/birthplace-preview'
import styles from './preview.module.css'
export default function Preview({rows, loadedAt}: {rows: PreviewResult[]; loadedAt: string}) {
  const [status, setStatus] = useState<PreviewStatus | 'all'>('catalunya')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const counts = summarizePreview(rows)
  const filtered = rows.filter(r => (status === 'all' || r.status === status) && normalizePlace([r.name, r.birthplace, ...r.candidates.map(m => m.name)].join(' ')).includes(normalizePlace(search)))
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pages)
  return <div className={styles.page}>
    <Link href="/scouting/players">← Player directory</Link>
    <header><span className={styles.eyebrow}>LOCAL · READ-ONLY PREVIEW</span><h1>Where were our players born?</h1><p>Proposed birthplace normalization from the official Spanish municipality catalogue. No player records or saved views are changed.</p></header>
    <div className={styles.notice}><strong>Candidate matches need verification.</strong> The catalogue covers Spain, not the world. A matching town name does not prove birth country: Barcelona, for example, has international namesakes. Nationality is displayed for context only and never used to assign a birthplace. This preview uses today’s administrative geography.</div>
    <section className={styles.cards} aria-label="Birthplace coverage">
      {(Object.keys(previewLabels) as PreviewStatus[]).map(key => <button className="ui-btn" data-variant={status === key ? 'primary' : 'ghost'} key={key} aria-pressed={status === key} onClick={() => {setStatus(key); setPage(1)}}><span>{previewLabels[key]}</span><strong>{counts[key].toLocaleString('en-GB')}</strong></button>)}
    </section>
    <p>{rows.length.toLocaleString('en-GB')} players inspected · {rows.length - counts.missing} usable birthplace values · {counts.missing} need birthplace enrichment.</p>
    <div className={styles.filters}>
      <label>Find player or birthplace<input value={search} onChange={e => {setSearch(e.target.value); setPage(1)}} placeholder="e.g. Castellar, Arnau, Barcelona"/></label>
      <label>Show<select value={status} onChange={e => {setStatus(e.target.value as typeof status); setPage(1)}}><option value="all">All players</option>{Object.entries(previewLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <button className="ui-btn" data-variant="ghost" onClick={() => {setSearch(''); setPage(1)}}>Clear search</button>
    </div>
    <p role="status">{filtered.length} players in this selection. Page {currentPage} of {pages}.</p>
    <div className={styles.table}><table><thead><tr><th>Player / nationality</th><th>Recorded birthplace</th><th>Proposed municipality</th><th>Proposed province / region</th><th>Evidence / next step</th><th>Profile fetch</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 50, currentPage * 50).map(row => <tr key={row.id}>
      <td><Link href={'/scouting/players?player=' + row.id}>{row.name}</Link><small>{row.country ?? 'Unknown nationality'} · {row.ranking ? '#' + row.ranking : 'Unranked'}</small></td>
      <td>{row.birthplace || 'Not recorded'}</td>
      <td>{row.candidates.length ? row.candidates.map(m => <div key={m.id}>{m.name}<small>INE {m.id}</small></div>) : 'Unresolved'}</td>
      <td>{row.candidates.length ? row.candidates.map(m => <div key={m.id}>{catalunyaProvinces[m.province] ?? 'Province ' + m.province}<small>{m.region === '09' ? 'Catalunya · 09' : 'Other Spain · region ' + m.region}</small></div>) : 'Unknown'}</td>
      <td><strong>{previewLabels[row.status]}</strong><p>{row.reason}</p></td>
      <td>{row.profile_status ?? 'No recorded status'}</td>
    </tr>)}</tbody></table></div>
    {!filtered.length && <p>No players match this selection.</p>}
    <nav className={styles.filters} aria-label="Preview pagination"><button className="ui-btn" data-variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} / {pages}</span><button className="ui-btn" data-variant="ghost" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>
    <footer><p>Reference: <a href={catalogueSource.url}>INE municipality catalogue · {catalogueSource.date}</a> · {catalogueSource.count} municipalities, {catalogueSource.catalunya} in Catalunya. Exact normalized names, bilingual names, article ordering and a small explicit alias dictionary are supported. No fuzzy or substring matching.</p><p>“Other Spain” is also a proposed mapping. “Unresolved / review” includes foreign locations; it does not mean the data is wrong. A successful profile fetch does not guarantee a recorded birthplace.</p><p>Snapshot loaded: {loadedAt} · Refresh the page to read current data. There are no database write actions on this page.</p></footer>
  </div>
}

'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export function UploadCourtDropzone() {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const onUpload = async (file: File) => {
    const name = prompt('Court name:', file.name.replace(/\.[^.]+$/, ''))
    if (!name) return
    setBusy(true)
    const fd = new FormData()
    fd.append('court', file)
    fd.append('name', name)
    const r = await fetch('/api/ops/padelgenius/courts', { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { alert('Upload failed'); return }
    router.refresh()
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/png" hidden onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ background: '#22c55e', color: '#0a0a14', border: '1px solid #15803d', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
        {busy ? 'UPLOADING...' : '+ UPLOAD NEW'}
      </button>
    </div>
  )
}

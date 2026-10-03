'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui'

export default function CoachPhotoUpload({ coachId, name, url, disabled = false, onSaved }: {
  coachId: string
  name: string
  url: string | null
  disabled?: boolean
  onSaved: (url: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function upload(file: File) {
    setError(null)
    setSaved(false)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP photo up to 2 MB.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('coachId', coachId)
      form.set('file', file)
      const res = await fetch('/api/internal/upload-coach-avatar', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not save coach photo')
      onSaved(body.url)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save coach photo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-start gap-3 py-2">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${name} avatar`} className="h-16 w-16 shrink-0 rounded-full object-cover" />
      ) : (
        <div aria-hidden="true" className="h-16 w-16 shrink-0 rounded-full flex items-center justify-center text-sm"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-3)' }}>
          {name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
        </div>
      )}
      <div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          aria-label={`Photo for ${name}`} disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }} />
        <Button type="button" size="sm" disabled={disabled || uploading} onClick={() => input.current?.click()}>
          {uploading ? 'Saving photo…' : url ? 'Replace photo' : 'Upload photo'}
        </Button>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>JPG, PNG or WebP · Up to 2 MB</p>
        {saved && <p role="status" className="mt-1 text-xs" style={{ color: 'var(--lime-text)' }}>Photo saved for avatar use.</p>}
        {error && <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--live-text)' }}>{error}</p>}
      </div>
    </div>
  )
}

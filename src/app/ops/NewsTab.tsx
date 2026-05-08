'use client'
// src/app/ops/NewsTab.tsx
// Ops dashboard tab for authoring first-party news posts.
// Two views inside one component:
//   - 'list' — table of EN posts with translation chips
//   - 'editor' — create/edit form

import { useEffect, useState, useCallback, type ChangeEvent } from 'react'

const NON_EN: ('es' | 'pt' | 'it' | 'fr')[] = ['es', 'pt', 'it', 'fr']

interface PostRow {
  id: string
  category: 'announcements' | 'product'
  slug: string
  title: string
  status: 'draft' | 'published'
  published_at: string | null
  updated_at: string
  cover_image_url: string | null
  translations: { es: boolean; pt: boolean; it: boolean; fr: boolean }
}

export default function NewsTab() {
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/news', { credentials: 'include' })
      const json = await res.json()
      setPosts(json.posts ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (view === 'editor') {
    return (
      <Editor
        postId={editingId}
        onClose={async () => {
          setEditingId(null)
          setView('list')
          await refresh()
        }}
      />
    )
  }

  return (
    <div className="p-4">
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-bold">News</h2>
        <button
          className="px-3 py-2 bg-green-500 text-black font-bold text-sm"
          onClick={() => { setEditingId(null); setView('editor') }}
        >
          + New post
        </button>
      </div>

      {loading ? <div>Loading…</div> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase opacity-70">
              <th className="p-2">Title</th>
              <th className="p-2">Slug</th>
              <th className="p-2">Cat.</th>
              <th className="p-2">Status</th>
              <th className="p-2">Translations</th>
              <th className="p-2">Updated</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {posts.map(p => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="p-2">{p.title}</td>
                <td className="p-2 font-mono text-xs opacity-70">{p.slug}</td>
                <td className="p-2 capitalize">{p.category}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 text-xs ${p.status === 'published' ? 'bg-green-500 text-black' : 'bg-white/10'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="p-2">
                  <div className="flex gap-1">
                    {NON_EN.map(loc => (
                      <span
                        key={loc}
                        title={p.translations[loc] ? 'translated' : 'pending'}
                        className={`text-[10px] px-1.5 py-0.5 ${p.translations[loc] ? 'bg-green-500 text-black' : 'bg-white/10 opacity-50'}`}
                      >
                        {loc.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-2 text-xs opacity-70">{new Date(p.updated_at).toLocaleString()}</td>
                <td className="p-2">
                  <button
                    className="text-xs underline"
                    onClick={() => { setEditingId(p.id); setView('editor') }}
                  >Edit</button>
                  {p.status === 'published' && (
                    <a
                      href={`/news/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline ml-2"
                    >View</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface EditorProps {
  postId: string | null
  onClose: () => void
}

function Editor({ postId, onClose }: EditorProps) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState<'announcements' | 'product'>('announcements')
  const [body, setBody] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugLocked, setSlugLocked] = useState(false)

  useEffect(() => {
    if (!postId) return
    ;(async () => {
      const res = await fetch(`/api/ops/news/${postId}`, { credentials: 'include' })
      if (!res.ok) return
      const { post } = await res.json()
      setTitle(post.title)
      setSlug(post.slug)
      setCategory(post.category)
      setBody(post.body_md)
      setCoverUrl(post.cover_image_url)
      setStatus(post.status)
      setSlugLocked(post.status === 'published')
    })()
  }, [postId])

  const onTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value
    setTitle(newTitle)
    if (!postId && !slugLocked) {
      const auto = newTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      setSlug(auto)
    }
  }

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/ops/news/upload', { method: 'POST', credentials: 'include', body: fd })
    const json = await res.json()
    if (json.url) setCoverUrl(json.url)
    else setError(json.error ?? 'Upload failed')
  }

  const onSave = async (publish: boolean) => {
    setError(null)
    setSaving(true)
    try {
      const targetStatus = publish ? 'published' : status
      const payload = {
        title,
        slug: postId ? undefined : slug,
        category,
        body_md: body,
        cover_image_url: coverUrl,
        status: targetStatus,
      }
      const url = postId ? `/api/ops/news/${postId}` : '/api/ops/news'
      const method = postId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 max-w-3xl">
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-bold">{postId ? 'Edit post' : 'New post'}</h2>
        <button onClick={onClose} className="text-xs underline">← Back</button>
      </div>

      {error && <div className="bg-red-500/20 border border-red-500 p-2 mb-4 text-sm">{error}</div>}

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Title</span>
        <input
          className="w-full bg-black/40 border border-white/10 p-2 mt-1"
          value={title}
          onChange={onTitleChange}
        />
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Slug {slugLocked && '(locked after publish)'}</span>
        <input
          className="w-full bg-black/40 border border-white/10 p-2 mt-1 font-mono text-xs"
          value={slug}
          disabled={slugLocked || !!postId}
          onChange={(e) => setSlug(e.target.value)}
        />
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Category</span>
        <select
          className="w-full bg-black/40 border border-white/10 p-2 mt-1"
          value={category}
          onChange={(e) => setCategory(e.target.value as 'announcements' | 'product')}
        >
          <option value="announcements">Announcements</option>
          <option value="product">Product</option>
        </select>
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Cover image (optional, 16:9 recommended)</span>
        <input type="file" accept="image/*" onChange={onUpload} className="block mt-1 text-sm" />
        {coverUrl && (
          <div className="mt-2">
            <img src={coverUrl} alt="cover preview" className="max-w-md" />
            <button className="text-xs underline mt-1" onClick={() => setCoverUrl(null)}>Remove</button>
          </div>
        )}
      </label>

      <label className="block mb-3">
        <span className="text-xs uppercase opacity-70">Body (Markdown)</span>
        <div className="flex gap-2 mt-1 mb-2">
          <button
            className={`px-2 py-1 text-xs ${!showPreview ? 'bg-white/10' : ''}`}
            onClick={() => setShowPreview(false)}
          >Edit</button>
          <button
            className={`px-2 py-1 text-xs ${showPreview ? 'bg-white/10' : ''}`}
            onClick={() => setShowPreview(true)}
          >Preview</button>
        </div>
        {showPreview ? (
          <div className="bg-black/40 border border-white/10 p-3 prose prose-invert max-w-none min-h-[300px]">
            <pre className="text-xs whitespace-pre-wrap">{body}</pre>
          </div>
        ) : (
          <textarea
            className="w-full bg-black/40 border border-white/10 p-2 font-mono text-xs"
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </label>

      <div className="flex gap-3 mt-4">
        <button
          disabled={saving}
          onClick={() => onSave(false)}
          className="px-4 py-2 bg-white/10 text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          disabled={saving}
          onClick={() => onSave(true)}
          className="px-4 py-2 bg-green-500 text-black text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing & translating…' : 'Publish'}
        </button>
      </div>
    </div>
  )
}

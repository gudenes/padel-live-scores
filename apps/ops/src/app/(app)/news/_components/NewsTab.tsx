'use client'
// apps/ops/src/app/(app)/news/_components/NewsTab.tsx
// Ops dashboard tab for authoring first-party news posts.
// Two views inside one component:
//   - 'list' — table of EN posts with translation chips
//   - 'editor' — create/edit form

import { useEffect, useState, useCallback, type ChangeEvent, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PageHeader, Panel, DataTable, Field, Pill, Button, Skeleton, EmptyState } from '@/components/ui'

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
      const res = await fetch('/api/internal/news', { credentials: 'include' })
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
    <div className="ui-page">
      <PageHeader
        title="News"
        actions={
          <Button variant="primary" onClick={() => { setEditingId(null); setView('editor') }}>
            + New post
          </Button>
        }
      />

      {loading ? (
        <Skeleton rows={4} />
      ) : posts.length === 0 ? (
        <Panel>
          <EmptyState title="No posts yet" hint="Create your first news post to get started." />
        </Panel>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Cat.</th>
              <th>Status</th>
              <th>Translations</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {posts.map(p => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{p.slug}</td>
                <td className="capitalize">{p.category}</td>
                <td>
                  <Pill tone={p.status === 'published' ? 'lime' : 'neutral'}>{p.status}</Pill>
                </td>
                <td>
                  <div className="flex gap-1">
                    {NON_EN.map(loc => (
                      <span
                        key={loc}
                        title={p.translations[loc] ? 'translated' : 'pending'}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 'var(--r-full)',
                          fontWeight: 600,
                          ...(p.translations[loc]
                            ? { color: 'var(--lime-text)', background: 'var(--lime-bg)' }
                            : { color: 'var(--text-4)', background: 'var(--bg-hover)' }),
                        }}
                      >
                        {loc.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-3)' }}>{new Date(p.updated_at).toLocaleString()}</td>
                <td>
                  <div className="ui-ph-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditingId(p.id); setView('editor') }}
                    >Edit</Button>
                    {p.status === 'published' && (
                      <a
                        href={`/news/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn"
                        data-variant="ghost"
                        data-size="sm"
                      >View</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
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
      const res = await fetch(`/api/internal/news/${postId}`, { credentials: 'include' })
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
    const res = await fetch('/api/internal/news/upload', { method: 'POST', credentials: 'include', body: fd })
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
      const url = postId ? `/api/internal/news/${postId}` : '/api/internal/news'
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
    <div className="ui-page" style={{ maxWidth: 768 }}>
      <PageHeader
        title={postId ? 'Edit post' : 'New post'}
        actions={<Button variant="ghost" size="sm" onClick={onClose}>← Back</Button>}
      />

      {error && (
        <div
          style={{
            color: 'var(--live-text)',
            background: 'var(--live-bg)',
            border: '1px solid var(--live-border)',
            borderRadius: 'var(--r-sm)',
            padding: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Title">
          <input className="ui-input" value={title} onChange={onTitleChange} />
        </Field>

        <Field label={`Slug${slugLocked ? ' (locked after publish)' : ''}`}>
          <input
            className="ui-input font-mono text-xs"
            value={slug}
            disabled={slugLocked || !!postId}
            onChange={(e) => setSlug(e.target.value)}
          />
        </Field>

        <Field label="Category">
          <select
            className="ui-select"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'announcements' | 'product')}
          >
            <option value="announcements">Announcements</option>
            <option value="product">Product</option>
          </select>
        </Field>

        <Field label="Cover image (optional, 16:9 recommended)">
          <input type="file" accept="image/*" onChange={onUpload} className="text-sm" />
          {coverUrl && (
            <div style={{ marginTop: 8 }}>
              <img src={coverUrl} alt="cover preview" style={{ maxWidth: 448 }} />
              <div style={{ marginTop: 4 }}>
                <Button variant="ghost" size="sm" onClick={() => setCoverUrl(null)}>Remove</Button>
              </div>
            </div>
          )}
        </Field>

        <Field label="Body (Markdown)">
          <div className="flex gap-2" style={{ marginBottom: 8 }}>
            <Button variant={!showPreview ? 'default' : 'ghost'} size="sm" onClick={() => setShowPreview(false)}>Edit</Button>
            <Button variant={showPreview ? 'default' : 'ghost'} size="sm" onClick={() => setShowPreview(true)}>Preview</Button>
          </div>
          {showPreview ? (
            <div
              className="prose max-w-none
                prose-headings:font-bold
                prose-p:leading-relaxed
                prose-a:no-underline hover:prose-a:underline
                prose-img:my-6"
              style={{
                background: 'var(--bg-card-2)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--r-lg)',
                padding: 24,
                minHeight: 300,
                color: 'var(--text-1)',
                ['--tw-prose-headings' as string]: 'var(--text-1)',
                ['--tw-prose-body' as string]: 'var(--text-1)',
                ['--tw-prose-bold' as string]: 'var(--text-1)',
                ['--tw-prose-links' as string]: 'var(--lime-text)',
                ['--tw-prose-bullets' as string]: 'var(--text-3)',
                ['--tw-prose-quotes' as string]: 'var(--text-2)',
                ['--tw-prose-quote-borders' as string]: 'var(--lime)',
              } as CSSProperties}
            >
              {body.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              ) : (
                <p style={{ color: 'var(--text-4)', fontStyle: 'italic' }}>Nothing to preview yet — switch back to Edit and add some content.</p>
              )}
            </div>
          ) : (
            <textarea
              className="ui-input font-mono text-xs"
              rows={20}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your post in Markdown.

# Heading 1
## Heading 2

**Bold** and *italic* text.

- Bullet list
- Another item

[Link text](https://example.com)

> Blockquote"
            />
          )}
        </Field>
      </div>

      <div className="flex gap-3" style={{ marginTop: 18 }}>
        <Button disabled={saving} onClick={() => onSave(false)}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="primary" disabled={saving} onClick={() => onSave(true)}>
          {saving ? 'Publishing & translating…' : 'Publish'}
        </Button>
      </div>
    </div>
  )
}

// src/hooks/useActiveAnnouncement.ts
'use client'

import { useEffect, useState } from 'react'
import type { Announcement } from '@/lib/announcement'

const POLL_MS = 60_000

/**
 * Fetches the active site announcement and re-polls every 60s so a freshly
 * published/retired alert appears/disappears without a manual reload. Returns
 * null until loaded and whenever there is no active announcement.
 */
export function useActiveAnnouncement(): Announcement | null {
  const [data, setData] = useState<Announcement | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/announcements/active')
        .then((r) => (r.ok ? r.json() : { announcement: null }))
        .then((d: { announcement: Announcement | null }) => {
          if (alive) setData(d.announcement)
        })
        .catch(() => {})
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return data
}

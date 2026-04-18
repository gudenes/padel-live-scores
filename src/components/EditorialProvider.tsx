'use client'
// src/components/EditorialProvider.tsx
// Context bridge from the tournament layout (server-fetched editorial)
// to the EditorialBlock component inside the client page. Enables SSR of
// the editorial text into the initial HTML response — Googlebot picks up
// the full editorial content on first crawl instead of having to re-render
// the page with JS to see it.
//
// The provider itself is a client component (contexts require one) but its
// VALUE is passed as a prop from a server component (the layout), so the
// initial payload includes the editorial data.

import { createContext, useContext, type ReactNode } from 'react'

export interface EditorialPost {
  kind: 'preview' | 'recap' | string
  headline: string
  lead: string
  body_md: string
  callout_key: string | null
  callout_value: string | null
  word_count: number
  generated_at: string
}

const EditorialContext = createContext<EditorialPost | null>(null)

export function EditorialProvider({
  post,
  children,
}: {
  post: EditorialPost | null
  children: ReactNode
}) {
  return (
    <EditorialContext.Provider value={post}>
      {children}
    </EditorialContext.Provider>
  )
}

/** Returns the editorial post for the current tournament + locale, or null. */
export function useEditorial(): EditorialPost | null {
  return useContext(EditorialContext)
}

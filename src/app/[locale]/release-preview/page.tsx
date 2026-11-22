import { notFound } from 'next/navigation'
import ReleasePreview from './ReleasePreview'

export const metadata = { title: 'What’s New · Local preview', robots: { index: false, follow: false } }

export default function ReleasePreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <ReleasePreview />
}

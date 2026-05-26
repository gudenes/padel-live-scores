// apps/ops/src/app/(app)/yt-channels/page.tsx
// YouTube Channels management — list, add, edit, delete, test.

import YtChannelsTab from './_components/YtChannelsTab'

export const metadata = { title: 'YT Channels · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function YtChannelsPage() {
  return <YtChannelsTab />
}

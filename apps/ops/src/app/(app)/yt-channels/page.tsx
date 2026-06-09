// apps/ops/src/app/(app)/yt-channels/page.tsx
// YouTube Channels — list/add/edit/delete + per-channel geo availability.

import YtChannelsShell from './_components/YtChannelsShell'

export const metadata = { title: 'YT Channels · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function YtChannelsPage() {
  return <YtChannelsShell />
}

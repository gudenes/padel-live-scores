// src/lib/youtube-channel-api.ts
//
// Minimal YouTube Data API v3 client that ONLY uses the cheap endpoints
// (1 quota unit each). Avoid `search.list` (100 units). For the FIP
// stream discovery cron, this is the entire surface we need.

const Y_BASE = 'https://www.googleapis.com/youtube/v3'

/**
 * Thrown when YouTube returns 403 with a quotaExceeded error code.
 * The discovery cron catches this to short-circuit gracefully instead
 * of failing the run.
 */
export class YouTubeQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YouTubeQuotaError'
  }
}

export interface PlaylistItem {
  videoId: string
  publishedAt: string
}

export interface VideoDetails {
  videoId: string
  title: string
  thumbnailUrl: string | null
  channelId: string
  liveBroadcastContent: 'live' | 'upcoming' | 'none'
  scheduledStartTime: string | null
  actualStartTime: string | null
  actualEndTime: string | null
  concurrentViewers: number | null
  viewCount: number | null
  regionRestriction: { allowed?: string[]; blocked?: string[] } | null
}

interface PlaylistItemsResponse {
  items: Array<{
    contentDetails: { videoId: string; videoPublishedAt?: string }
  }>
}

interface VideosResponse {
  items: Array<{
    id: string
    snippet: {
      title: string
      channelId: string
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
      liveBroadcastContent: 'live' | 'upcoming' | 'none'
    }
    liveStreamingDetails?: {
      scheduledStartTime?: string
      actualStartTime?: string
      actualEndTime?: string
      concurrentViewers?: string
    }
    statistics?: { viewCount?: string }
    contentDetails?: { regionRestriction?: { allowed?: string[]; blocked?: string[] } }
  }>
}

async function throwForBadResponse(res: Response, label: string): Promise<never> {
  const body = await res.text()
  if (res.status === 403 && body.includes('quotaExceeded')) {
    throw new YouTubeQuotaError(`${label}: quota exhausted`)
  }
  throw new Error(`${label} failed: ${res.status} ${body}`)
}

export async function listUploadsPlaylistItems(
  playlistId: string,
  apiKey: string,
  maxResults = 50,
): Promise<PlaylistItem[]> {
  const params = new URLSearchParams({
    playlistId,
    part: 'contentDetails',
    maxResults: String(maxResults),
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/playlistItems?${params}`)
  if (!res.ok) await throwForBadResponse(res, 'YouTube playlistItems')
  const json = (await res.json()) as PlaylistItemsResponse
  return (json.items ?? []).map(it => ({
    videoId: it.contentDetails.videoId,
    publishedAt: it.contentDetails.videoPublishedAt ?? '',
  }))
}

/**
 * Fetch details for up to 50 video IDs in a single call (1 quota unit
 * regardless of count). Used by the discovery cron to find currently-live
 * broadcasts and by ops "test" actions.
 */
export async function listVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<VideoDetails[]> {
  if (videoIds.length === 0) return []
  if (videoIds.length > 50) {
    throw new Error(`listVideoDetails: max 50 IDs per call, got ${videoIds.length}`)
  }
  const params = new URLSearchParams({
    id: videoIds.join(','),
    part: 'snippet,liveStreamingDetails,statistics,contentDetails',
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/videos?${params}`)
  if (!res.ok) await throwForBadResponse(res, 'listVideoDetails')
  const json = (await res.json()) as VideosResponse
  return (json.items ?? []).map(it => ({
    videoId: it.id,
    title: it.snippet.title,
    thumbnailUrl: it.snippet.thumbnails?.medium?.url ?? it.snippet.thumbnails?.default?.url ?? null,
    channelId: it.snippet.channelId,
    liveBroadcastContent: it.snippet.liveBroadcastContent,
    scheduledStartTime: it.liveStreamingDetails?.scheduledStartTime ?? null,
    actualStartTime: it.liveStreamingDetails?.actualStartTime ?? null,
    actualEndTime: it.liveStreamingDetails?.actualEndTime ?? null,
    concurrentViewers: it.liveStreamingDetails?.concurrentViewers
      ? parseInt(it.liveStreamingDetails.concurrentViewers, 10)
      : null,
    viewCount: it.statistics?.viewCount ? parseInt(it.statistics.viewCount, 10) : null,
    regionRestriction: it.contentDetails?.regionRestriction ?? null,
  }))
}

export async function fetchVideoDetailsBatch(
  videoIds: string[],
  apiKey: string,
): Promise<VideoDetails[]> {
  if (videoIds.length === 0) return []
  if (videoIds.length > 50) {
    throw new Error('fetchVideoDetailsBatch: max 50 IDs per call')
  }
  const params = new URLSearchParams({
    id: videoIds.join(','),
    part: 'snippet,liveStreamingDetails,statistics,contentDetails',
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/videos?${params}`)
  if (!res.ok) await throwForBadResponse(res, 'YouTube videos')
  const json = (await res.json()) as VideosResponse
  return (json.items ?? []).map(v => ({
    videoId: v.id,
    title: v.snippet.title,
    thumbnailUrl:
      v.snippet.thumbnails?.medium?.url ??
      v.snippet.thumbnails?.default?.url ??
      null,
    channelId: v.snippet.channelId,
    liveBroadcastContent: v.snippet.liveBroadcastContent,
    scheduledStartTime: v.liveStreamingDetails?.scheduledStartTime ?? null,
    actualStartTime: v.liveStreamingDetails?.actualStartTime ?? null,
    actualEndTime: v.liveStreamingDetails?.actualEndTime ?? null,
    concurrentViewers: v.liveStreamingDetails?.concurrentViewers
      ? parseInt(v.liveStreamingDetails.concurrentViewers, 10)
      : null,
    viewCount: v.statistics?.viewCount ? parseInt(v.statistics.viewCount, 10) : null,
    regionRestriction: v.contentDetails?.regionRestriction ?? null,
  }))
}

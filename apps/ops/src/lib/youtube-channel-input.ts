// src/lib/youtube-channel-input.ts
//
// Parses operator-pasted YouTube channel input into either a channel ID
// or a handle. The ops add-channel route then calls
// `channels.list?id=...` or `channels.list?forHandle=...` to validate
// and get any missing data.
//
// Channel IDs always start with 'UC' and are 24 chars total.
// Handles can be @-prefixed or bare; URLs come in /@handle, /channel/UC,
// and the legacy /c/slug forms.

export type ParsedYoutubeInput =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/

export function parseYoutubeChannelInput(input: string): ParsedYoutubeInput | null {
  const s = input.trim()
  if (!s) return null

  // Raw channel ID
  if (CHANNEL_ID_RE.test(s)) return { kind: 'id', value: s }

  // /channel/UCxxxx URL
  const channelUrlMatch = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\b/)
  if (channelUrlMatch) return { kind: 'id', value: channelUrlMatch[1]! }

  // /@handle URL
  const handleUrlMatch = s.match(/youtube\.com\/@([A-Za-z0-9_.-]+)/)
  if (handleUrlMatch) return { kind: 'handle', value: handleUrlMatch[1]! }

  // /c/slug URL — legacy vanity, treat slug as handle
  const cSlugMatch = s.match(/youtube\.com\/c\/([A-Za-z0-9_.-]+)/)
  if (cSlugMatch) return { kind: 'handle', value: cSlugMatch[1]! }

  // Bare @handle
  if (s.startsWith('@')) {
    const value = s.slice(1)
    if (/^[A-Za-z0-9_.-]+$/.test(value)) return { kind: 'handle', value }
    return null
  }

  // Bare slug (no @, no URL) — accept as handle
  if (/^[A-Za-z0-9_.-]+$/.test(s)) return { kind: 'handle', value: s }

  return null
}

// Local types for the YT Channels ops tab. The shape mirrors the
// /api/internal/youtube-channels response: snake_case from Supabase, with
// a `live` array decoration added by GET.

export interface OpsChannel {
  id: string
  channel_id: string
  uploads_playlist_id: string
  name: string
  abbreviation: string
  color_hex: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  live: Array<{ videoId: string; title: string }>
}

export interface OpsChannelEditFields {
  name: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  isActive: boolean
}

// src/lib/quality-scoring.ts
// Computes quality_score for articles based on multiple signals.

export function computeArticleQuality(article: {
  title: string
  source_weight: number
  click_count: number
  impression_count: number
  quality_score: number | null
}, globalAvgCTR: number, sourceDailyCount: number): number {
  let q = article.source_weight ?? 1.0

  // Title quality (0.7–1.0)
  const tLen = article.title.length
  if (tLen < 20 || tLen > 120) q *= 0.8
  const capsWords = article.title.split(' ').filter(w => w === w.toUpperCase() && w.length > 2).length
  if (capsWords > 2) q *= 0.7
  if (/[!?]{2,}/.test(article.title)) q *= 0.8

  // Engagement rate (0.9–1.3)
  if (article.impression_count > 10) {
    const bayesian = (article.click_count + 20 * globalAvgCTR) / (article.impression_count + 20)
    q *= 0.9 + Math.min(bayesian * 4, 0.4)
  } else {
    q *= 1 + 0.1 * Math.log10(1 + article.click_count)
  }

  // Flood penalty
  if (sourceDailyCount > 5) q *= 0.8

  return Math.round(q * 100) / 100
}

export function computeVideoQuality(video: {
  title: string
  channel_quality_score: number | null
  duration: string | null
}): number {
  let q = video.channel_quality_score ?? 1.0

  const dur = parseDurationSeconds(video.duration)
  if (dur < 30) q *= 0.7
  else if (dur < 60) q *= 0.85
  else if (dur > 2700) q *= 0.8

  const tLen = video.title.length
  if (tLen < 10 || tLen > 150) q *= 0.8
  const capsWords = video.title.split(' ').filter(w => w === w.toUpperCase() && w.length > 2).length
  if (capsWords > 3) q *= 0.7

  return Math.round(q * 100) / 100
}

function parseDurationSeconds(dur: string | null): number {
  if (!dur) return 0
  const parts = dur.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

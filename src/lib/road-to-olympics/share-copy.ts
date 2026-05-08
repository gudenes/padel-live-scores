// src/lib/road-to-olympics/share-copy.ts
//
// Pre-filled copy for the Action Hub: tweet intent, copy-paste email template.
// Per-language and per-country variants land in the Hardening Wave —
// for Soft Launch this is English-only, generic "your country's sports authority".

const HASHTAG = '#PadelOlympics'
const HUB_URL = 'https://padelnachos.com/road-to-olympics'

/** URL for `https://twitter.com/intent/tweet` with current scorecard headline. */
export function buildTweetIntentUrl(opts: {
  daysUntil: number
  federations: number
}): string {
  const text = `${opts.daysUntil} days until the IOC decides Brisbane 2032 sports.\n` +
    `Padel: ${opts.federations} federations, 5 continents, ready to play.\n` +
    `Make padel an Olympic sport. ${HASHTAG}\n${HUB_URL}`
  const params = new URLSearchParams({ text })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

/** Plain-text body fans can copy into an email to their NOC President. */
export function buildEmailToNocBody(opts: {
  daysUntil: number
  federations: number
}): string {
  return `Subject: Please support padel for Brisbane 2032

Dear NOC President,

I'm writing as a padel fan to ask the National Olympic Committee to support
padel's inclusion in the Brisbane 2032 Olympic Games programme.

The IOC decision is ${opts.daysUntil} days away. Padel meets the global-reach
threshold (${opts.federations} national federations, 5 continents), is fully
WADA-compliant, advances gender parity, and is now a medal sport at the
Aichi-Nagoya 2026 Asian Games and the AIMAG Riyadh 2026 Indoor & Martial Arts Games.

A vote to include padel would expand the Games' youth and global appeal —
exactly the priorities Brisbane 2032 has stated publicly.

Thank you for considering this request.

${HASHTAG}`
}

/** Same as above, addressed at a national Sports Minister / Secretary. */
export function buildEmailToSportsMinisterBody(opts: {
  daysUntil: number
  federations: number
}): string {
  return `Subject: Public support for padel — Brisbane 2032 Olympic inclusion

Dear Sports Minister,

I'm writing as a padel fan and a citizen interested in our country's sports
policy. I would like to ask for your government's public support of padel's
inclusion in the Brisbane 2032 Olympic Games.

The IOC decision is ${opts.daysUntil} days away. Padel currently has
${opts.federations} national federations across 5 continents, is fully
WADA-compliant, and is already an official medal sport at the
Aichi-Nagoya 2026 Asian Games.

Public support from your office — to our National Olympic Committee, in the
press, or through formal channels — would meaningfully strengthen the case
that the IOC is being asked to consider.

Thank you for your time.

${HASHTAG}`
}

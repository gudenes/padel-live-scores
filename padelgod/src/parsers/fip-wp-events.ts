// Parses the response from `https://www.padelfip.com/wp-json/wp/v2/events`.
// Validated shape documented in:
//   docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md §6.1
//
// When the request is made with `?_embed=true`, the response also
// carries `_embedded['wp:featuredmedia'][0].source_url` — that's the
// tournament poster/cover image we use as the public-facing cover.

import { decodeHtmlEntities } from '../lib/html-entities.js';

export interface ParsedTournament {
  wpId: number;
  slug: string;
  name: string;
  link: string;
  modifiedGmt: string;
  publishedGmt: string | null;
  featuredMediaId: number;
  /**
   * Resolved URL of the featured-media (poster/cover) image, if the
   * request was made with `?_embed=true` and the event has one
   * attached. Null otherwise.
   */
  featuredMediaUrl: string | null;
  countryTermIds: number[];
  genderTermIds: number[];
  categoryTermIds: number[];
  yearTermIds: number[];
}

interface RawEmbeddedMedia {
  source_url?: string;
}

interface RawEvent {
  id: number;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  date_gmt?: string;
  modified_gmt?: string;
  featured_media?: number;
  country?: number[];
  gender?: number[];
  'category-event'?: number[];
  'event-year'?: number[];
  _embedded?: {
    'wp:featuredmedia'?: RawEmbeddedMedia[];
  };
}

export function parseFipWpEvents(events: RawEvent[]): ParsedTournament[] {
  if (!Array.isArray(events)) return [];
  const out: ParsedTournament[] = [];
  for (const e of events) {
    const slug = (e.slug ?? '').trim();
    const name = decodeHtmlEntities((e.title?.rendered ?? '').trim());
    if (!slug || !name) continue;
    const embeddedMedia = e._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    out.push({
      wpId: e.id,
      slug,
      name,
      link: e.link ?? '',
      modifiedGmt: e.modified_gmt ?? '',
      publishedGmt: e.date_gmt ?? null,
      featuredMediaId: e.featured_media ?? 0,
      featuredMediaUrl:
        typeof embeddedMedia === 'string' && embeddedMedia.length > 0
          ? embeddedMedia
          : null,
      countryTermIds: Array.isArray(e.country) ? e.country : [],
      genderTermIds: Array.isArray(e.gender) ? e.gender : [],
      categoryTermIds: Array.isArray(e['category-event']) ? e['category-event'] : [],
      yearTermIds: Array.isArray(e['event-year']) ? e['event-year'] : [],
    });
  }
  return out;
}

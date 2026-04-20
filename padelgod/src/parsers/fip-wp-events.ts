// Parses the response from `https://www.padelfip.com/wp-json/wp/v2/events`.
// Validated shape documented in:
//   docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md §6.1

export interface ParsedTournament {
  wpId: number;
  slug: string;
  name: string;
  link: string;
  modifiedGmt: string;
  publishedGmt: string | null;
  featuredMediaId: number;
  countryTermIds: number[];
  genderTermIds: number[];
  categoryTermIds: number[];
  yearTermIds: number[];
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
}

export function parseFipWpEvents(events: RawEvent[]): ParsedTournament[] {
  if (!Array.isArray(events)) return [];
  const out: ParsedTournament[] = [];
  for (const e of events) {
    const slug = (e.slug ?? '').trim();
    const name = (e.title?.rendered ?? '').trim();
    if (!slug || !name) continue;
    out.push({
      wpId: e.id,
      slug,
      name,
      link: e.link ?? '',
      modifiedGmt: e.modified_gmt ?? '',
      publishedGmt: e.date_gmt ?? null,
      featuredMediaId: e.featured_media ?? 0,
      countryTermIds: Array.isArray(e.country) ? e.country : [],
      genderTermIds: Array.isArray(e.gender) ? e.gender : [],
      categoryTermIds: Array.isArray(e['category-event']) ? e['category-event'] : [],
      yearTermIds: Array.isArray(e['event-year']) ? e['event-year'] : [],
    });
  }
  return out;
}

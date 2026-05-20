import { describe, it, expect } from 'vitest';
import { parseFipWpEvents } from '../../parsers/fip-wp-events.js';

describe('parseFipWpEvents', () => {
  it('extracts core fields from a single event', () => {
    const apiResponse = [
      {
        id: 321621,
        slug: 'fip-promises-kyalami-2026',
        link: 'https://www.padelfip.com/events/fip-promises-kyalami-2026/',
        title: { rendered: 'FIP Promises Kyalami 2026' },
        date_gmt: '2026-04-16T13:28:25',
        modified_gmt: '2026-04-16T13:30:10',
        featured_media: 0,
        country: [331],
        'event-year': [705],
        gender: [37, 36],
        'category-event': [708],
        status: 'publish',
        type: 'events',
      },
    ];

    const result = parseFipWpEvents(apiResponse as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      wpId: 321621,
      slug: 'fip-promises-kyalami-2026',
      name: 'FIP Promises Kyalami 2026',
      link: 'https://www.padelfip.com/events/fip-promises-kyalami-2026/',
      modifiedGmt: '2026-04-16T13:30:10',
      countryTermIds: [331],
      genderTermIds: [37, 36],
      categoryTermIds: [708],
      featuredMediaUrl: null,
    });
  });

  it('extracts featuredMediaUrl from _embedded["wp:featuredmedia"]', () => {
    const apiResponse = [
      {
        id: 999,
        slug: 'fip-silver-hop-london-padel-open-2026',
        title: { rendered: 'FIP Silver HOP London Padel Open 2026' },
        modified_gmt: '2026-05-15T00:00:00',
        featured_media: 12345,
        _embedded: {
          'wp:featuredmedia': [
            {
              source_url:
                'https://www.padelfip.com/wp-content/uploads/2025/12/HOP_SILVER2026_Poster-724x1024.jpg',
            },
          ],
        },
      },
    ];
    const result = parseFipWpEvents(apiResponse as any);
    expect(result).toHaveLength(1);
    expect(result[0].featuredMediaUrl).toBe(
      'https://www.padelfip.com/wp-content/uploads/2025/12/HOP_SILVER2026_Poster-724x1024.jpg',
    );
    expect(result[0].featuredMediaId).toBe(12345);
  });

  it('treats empty _embedded.wp:featuredmedia as null', () => {
    const apiResponse = [
      {
        id: 1,
        slug: 'ok',
        title: { rendered: 'Ok' },
        modified_gmt: 'x',
        _embedded: { 'wp:featuredmedia': [] },
      },
    ];
    expect(parseFipWpEvents(apiResponse as any)[0].featuredMediaUrl).toBeNull();
  });

  it('treats missing source_url as null', () => {
    const apiResponse = [
      {
        id: 1,
        slug: 'ok',
        title: { rendered: 'Ok' },
        modified_gmt: 'x',
        _embedded: { 'wp:featuredmedia': [{}] },
      },
    ];
    expect(parseFipWpEvents(apiResponse as any)[0].featuredMediaUrl).toBeNull();
  });

  it('skips entries without slug or title', () => {
    const apiResponse = [
      { id: 1, slug: '', title: { rendered: '' }, modified_gmt: 'x' },
      { id: 2, slug: 'ok', title: { rendered: 'Ok Event' }, modified_gmt: '2026-01-01T00:00:00' },
    ];
    const result = parseFipWpEvents(apiResponse as any);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('ok');
  });

  it('returns empty array for empty input', () => {
    expect(parseFipWpEvents([])).toEqual([]);
  });
});

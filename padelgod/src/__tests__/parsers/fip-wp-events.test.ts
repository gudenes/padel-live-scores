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
    });
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

import { describe, it, expect } from 'vitest';
import { parseEventDates, parseMatchscorerIds } from '../../parsers/fip-event-page-detail.js';

describe('parseEventDates', () => {
  it('parses DD/MM/YYYY range from header', () => {
    const html = '<div>15/03/2025 - 22/03/2025</div>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-03-15',
      endsAt: '2025-03-22',
    });
  });

  it('prefers the labelled "Main draw" date over the header range', () => {
    const html = `
      <p>PRACTICE: Available 20/04/2026 - 22/04/2026</p>
      <span>Main draw 25/04/2026</span>
      <span>Last day 30/04/2026</span>
    `;
    const result = parseEventDates(html);
    expect(result.startsAt).toBe('2026-04-25');
  });

  it('returns nulls when no dates appear', () => {
    expect(parseEventDates('<p>nothing here</p>')).toEqual({
      startsAt: null,
      endsAt: null,
    });
  });

  it('falls back to the first single date if no range is present', () => {
    const html = '<p>Date: 05/09/2025</p>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-09-05',
      endsAt: null,
    });
  });
});

describe('parseMatchscorerIds', () => {
  it('parses numeric eventID + builds FIP-{year}-{id} code', () => {
    const html = `
      const eventYear = "2025";
      const eventID = "3301";
      const totalday = 5;
    `;
    const result = parseMatchscorerIds(html);
    expect(result).toEqual({
      year: '2025',
      id: '3301',
      totalDays: 5,
      code: 'FIP-2025-3301',
      widget: 'draw',
    });
  });

  it('accepts alphanumeric eventID for FIP Beyond / Promises', () => {
    const html = `
      const eventYear = "2026";
      const eventID   = "B0118";
      const totalday  = 4;
      const widget    = 'oopbyday';
    `;
    const result = parseMatchscorerIds(html);
    expect(result?.id).toBe('B0118');
    expect(result?.code).toBe('FIP-2026-B0118');
    expect(result?.widget).toBe('oopbyday');
    expect(result?.totalDays).toBe(4);
  });

  it('returns null when eventID is missing', () => {
    expect(parseMatchscorerIds('<p>no js block</p>')).toBeNull();
  });

  it('defaults widget to "draw" when not declared', () => {
    const html = 'const eventYear="2025";const eventID="42";const totalday=1;';
    expect(parseMatchscorerIds(html)?.widget).toBe('draw');
  });
});

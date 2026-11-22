import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/entry-draw/mexico-major-2026-men.json';
import { reconcileMainDrawEntries } from '../../lib/entry-draw-reconciliation.js';

const { entries, draw } = fixture;
const galan = entries.find(e => e.player1_name === 'Alejandro Galan')!;

describe('entry roster after a main-draw withdrawal', () => {
  it('removes Galan/Chingotto, reseeds from the Mexico draw and keeps qualifying entries', () => {
    const result = reconcileMainDrawEntries(entries, draw);
    expect(result.applied).toBe(true);
    expect(result.entries).toHaveLength(entries.length - 1);
    expect(result.entries.some(e => e.player1_id === galan.player1_id)).toBe(false);
    expect(result.entries.find(e => e.player1_name === 'Juan Lebron')?.seed).toBe(2);
    expect(result.entries.find(e => e.player1_name === 'Carlos Daniel Gutierrez')?.seed).toBe(16);
    expect(result.entries.find(e => e.player1_name === 'Alejandro Arroyo')?.seed).toBeNull();
    expect(result.entries.filter(e => e.draw_type === 'qualifying')).toEqual(entries.filter(e => e.draw_type === 'qualifying'));
    expect(entries).toContain(galan); // original source retained
  });

  it('is idempotent when the old entry PDF is fetched again', () => {
    const once = reconcileMainDrawEntries(entries, draw).entries;
    expect(reconcileMainDrawEntries(once, draw).entries).toEqual(once);
  });

  it('keeps the PDF roster before release and for later-round-only evidence', () => {
    expect(reconcileMainDrawEntries(entries, []).applied).toBe(false);
    expect(reconcileMainDrawEntries(entries, draw.filter(r => r.round_label !== 'R64')).applied).toBe(false);
  });

  it('does not fill a partial new capture with old bracket rows', () => {
    const partial = { ...draw[0]!, scrape_job_id: 'new', captured_at: '2099-01-01' };
    expect(reconcileMainDrawEntries(entries, [...draw, partial]).entries).toEqual(entries);
  });

  it('rejects incomplete, duplicated, or unresolved opening-round teams', () => {
    const opening = draw.filter(r => r.round_label === 'R64');
    for (const invalid of [
      opening.slice(1),
      [...opening.slice(1), opening[1]!],
      [{ ...opening[0]!, team1_player1_name: 'Unknown Replacement' }, ...opening.slice(1)],
      [{ ...opening[0]!, team1_player2_name: null }, ...opening.slice(1)],
    ]) {
      expect(reconcileMainDrawEntries(entries, invalid).entries).toEqual(entries);
    }
  });

  it('does not choose arbitrarily between duplicate player identities', () => {
    const coello = entries.find(e => e.player1_name === 'Arturo Coello')!;
    const ambiguous = [...entries, { ...coello, player1_id: 'other-person', draw_type: 'qualifying' }];
    expect(reconcileMainDrawEntries(ambiguous, draw).applied).toBe(false);
  });
});

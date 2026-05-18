import { describe, it, expect, vi } from 'vitest';
import { runPlayerProfile } from '../../workers/player-profile.js';

function fakeSupabase() {
  const updates: any[] = [];
  return {
    updates,
    schema: () => ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: () => ({
      update: (changes: any) => ({
        eq: (col: string, val: any) => {
          updates.push({ changes, where: { [col]: val } });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

describe('runPlayerProfile', () => {
  it('updates the player row from a profile fetch', async () => {
    const supabase = fakeSupabase();
    const httpClient = {
      get: vi.fn(async () => ({
        data: `<span data-fip-id="P12345">P12345</span>
               <script type="application/ld+json">{
                 "@type": "Person",
                 "birthDate": "1995-04-21",
                 "height": "190 cm"
               }</script>
               <div class="racket-brand">Nox</div>
               <div class="racket-model">AT10</div>`,
      })),
    };

    const result = await runPlayerProfile(
      {
        supabase: supabase as any,
        httpClient: httpClient as any,
      },
      { playerId: 'plr-uuid-1', slug: 'juan-lebron' }
    );

    expect(result.updated).toBe(true);
    expect(result.fipId).toBe('P12345');
    // The profile parser exposes fipId via the result so callers can
    // observe what was on the page, but the worker deliberately does
    // NOT write it to public.players. Commit b9a06a5a — the DB stores
    // fip_id with a 'fip-' prefix (e.g. 'fip-P203884') as the padelgod
    // join-key convention, while the FIP page emits the raw form
    // ('P203884'). Writing the parsed value back mutated the canonical
    // prefixed id and broke the queue. fip_id is set authoritatively
    // by the entry-list populator + rankings worker now.
    expect(supabase.updates[0].changes).toMatchObject({
      birthdate: '1995-04-21',
    });
    expect(supabase.updates[0].changes).not.toHaveProperty('fip_id');
  });
});

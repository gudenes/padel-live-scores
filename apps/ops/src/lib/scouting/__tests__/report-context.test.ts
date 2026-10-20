import { it, expect, vi, beforeEach } from "vitest";
const { auth, query } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ pgPool: () => ({ query }) }));
import { reportContext } from "../report-context";
const id = "bcaf2101-d5ae-4152-9447-31ac119a1f67";
beforeEach(() => {
  query.mockReset();
  auth.mockReset();
});
it("never reads metadata or PBP without report permissions", async () => {
  auth.mockResolvedValue({ user: { id: "unauthorized" } });
  expect((await reportContext(id)).pbp).toEqual([]);
  expect(query).not.toHaveBeenCalled();
});
it("keeps private match context out of public match and PBP tables", async () => {
  auth.mockResolvedValue({ user: { isScouter: true } });
  query.mockResolvedValue({
    rows: [
      {
        tournament: "Archive",
        scheduled_at: "2018-10-08",
        players: [{ id: "private-player", name: "Unknown" }],
      },
    ],
  });
  const result = await reportContext(id, true);
  expect(result.meta.tournament).toBe("Archive");
  expect(result.pbp).toEqual([]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("operator_manual_scouting_matches");
});
it("keeps saved report usable during optional official metadata failures", async () => {
  auth.mockResolvedValue({ user: { isViewer: true } });
  query.mockRejectedValue(Error("Unavailable"));
  expect((await reportContext(id)).unavailable).toBe(true);
});
it('resolves reusable profile avatars without changing saved match player IDs', async () => {
  auth.mockResolvedValue({ user: { isScouter: true } });
  const local='f273d7ed-6543-448a-8339-a7f17bef353d';
  const linked='01b6794f-9813-4db8-899a-56a23230df13';
  query.mockResolvedValueOnce({rows:[{players:[{id:local,name:'Player',existingPlayerId:linked}],tournament:'FCP'}]})
    .mockResolvedValueOnce({rows:[{id:linked,name:'Player',avatar_url:'https://example.com/avatar.png'}]});
  const result=await reportContext(id,true);
  expect(query.mock.calls[1][1]).toEqual([[linked]]);
  expect(result.avatars[local]).toBe('https://example.com/avatar.png');
  expect(result.players?.[0].id).toBe(local);
});

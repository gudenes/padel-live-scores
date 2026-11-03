import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseCupTeams,
  parseCupGroups,
  parseCupStreams,
} from "../world-cup-parser";
import { isWorldCupDay } from "../world-cup";
const fixture = (file: string) =>
  readFileSync(
    new URL(`./fixtures/world-cup/${file}.html`, import.meta.url),
    "utf8"
  );
describe("FIP World Cup official HTML", () => {
  it("keeps country squads separate from pairings and coaches", () => {
    const teams = parseCupTeams(fixture("entrylist"));
    expect(teams).toHaveLength(32);
    const spain = teams.find(
      (x) => x.name === "Spain" && x.category === "men"
    )!;
    expect(spain.country).toBe("ESP");
    expect(spain.players).toHaveLength(8);
    expect(spain.players).toContain("Arturo Coello");
    expect(spain.players.join(" ")).not.toContain("Gutiérrez");
    expect(
      teams.find((x) => x.name === "Spain" && x.category === "women")?.players
    ).toContain("Gemma Triay Pons");
  });
  it("reads scheduled country ties without fabricating player pairings or live status", () => {
    const ties = parseCupStreams(fixture("streams"));
    expect(ties).toHaveLength(13);
    expect(ties.find((x) => x.home === "Spain")).toMatchObject({
      home: "Spain",
      away: "Sweden",
      category: "men",
      group: "B",
      scheduledAt: "2026-11-02T15:00:00.000Z",
      videoId: "1XlDMy1A_ec",
    });
    expect(ties.some((x) => x.home.includes("Ceremony"))).toBe(false);
  });
  it("retains live women streams without inventing a scheduled start", () => {
    const html = '<li class="bw-yt-item"><a data-yt="3fYq7vGxbwA" data-title="Netherlands vs USA"><span class="bw-yt-badge--live">Live</span><span class="bw-yt-tags">WOMEN · GROUP D</span></a></li>';
    expect(parseCupStreams(html, new Date('2026-11-03T11:00:00Z'))[0]).toMatchObject({category:'women',scheduledAt:null,liveObservedAt:'2026-11-03T11:00:00.000Z',videoId:'3fYq7vGxbwA'});
    expect(parseCupStreams(html.replace('bw-yt-badge--live', 'replay'))).toEqual([]);
  });
  it("reads both categories and four groups each, without duplicating nested opponents", () => {
    const groups = parseCupGroups(fixture("groups"));
    expect(groups).toHaveLength(8);
    expect(groups.every((g) => g.teams.length === 4)).toBe(true);
    expect(
      groups
        .find((g) => g.category === "men" && g.name === "Group B")
        ?.teams.map((x) => x.name)
    ).toEqual(["Spain", "Uae", "Sweden", "Paraguay"]);
  });
  it("fails empty for unrecognised HTML and excludes dates outside the event", () => {
    expect(parseCupStreams("<html>Unavailable</html>")).toEqual([]);
    expect(parseCupTeams("")).toEqual([]);
    expect(isWorldCupDay("2026-11-02")).toBe(true);
    expect(isWorldCupDay("2026-11-07")).toBe(true);
    expect(isWorldCupDay("2026-11-08")).toBe(false);
  });
});
describe('broadcast language labels',()=>{
 const card=(title:string,id:string)=>`<li class="bw-yt-item"><a data-yt="${id}" data-title="${title}"><span class="bw-yt-badge--live">Live</span><span class="bw-yt-tags">MEN · GROUP D</span></a></li>`
 it('groups English and Spanish streams under one real country tie',()=>{
  const ties=parseCupStreams(card('[ENG] 🇮🇹 Italy vs Mexico 🇲🇽','g0M7qNVQ6kw')+card('[ESP] 🇮🇹 Italy vs Mexico 🇲🇽','XmHXJj55beE'))
  expect(ties).toHaveLength(1)
  expect(ties[0]).toMatchObject({id:'men-italy-mexico',home:'Italy',away:'Mexico',videoId:'g0M7qNVQ6kw',streams:[{videoId:'g0M7qNVQ6kw',language:'ENG'},{videoId:'XmHXJj55beE',language:'ESP'}]})
 })
 it('supports parenthesized labels, deduplicates videos, and retains ordinary country names',()=>{
  expect(parseCupStreams(card('(ESP) Italy vs Mexico','abcdefghijk')+card('(ESP) Italy vs Mexico','abcdefghijk'))[0].streams).toHaveLength(1)
  expect(parseCupStreams(card('England vs Mexico','abcdefghijk'))[0].home).toBe('England')
 })
})

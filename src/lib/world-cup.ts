import { normalizeCountry } from "./country";
/** Verified FIP national-team event; never match the pairs championship by name. */
export const WORLD_CUP = {
  tournamentId: "2c1a0800-3bd6-424c-92f1-5417fea2cba1",
  coverImage: "https://www.padelfip.com/wp-content/uploads/2026/07/FIPWPC2026_Poster@05x-1.jpg",
  widgetCode: "FIP-2026-4516",
  startsOn: "2026-11-02",
  endsOn: "2026-11-07",
  eventUrl: "https://www.padelfip.com/es/eventos/fip-world-cup-2026-2/",
} as const;
export type CupCategory = "men" | "women";
export interface CupTeam {
  name: string;
  country: string | null;
  players: string[];
  profiles?: Record<string, { id: string; name: string; avatarUrl: string | null }>;
  category: CupCategory;
}
export interface CupTie {
  id: string;
  category: CupCategory;
  group: string | null;
  home: string;
  away: string;
  scheduledAt: string | null;
  liveObservedAt?: string;
  videoId: string;
}
export interface CupStanding {
  name: string;
  country: string | null;
  points: number | null;
  rubbers: string;
}
export interface CupGroup {
  name: string;
  category: CupCategory;
  teams: CupStanding[];
}
export interface CupData {
  ties: CupTie[];
  teams: CupTeam[];
  groups: CupGroup[];
  fetchedAt: string;
  partial: boolean;
}
export function isWorldCupDay(iso: string) {
  return iso >= WORLD_CUP.startsOn && iso <= WORLD_CUP.endsOn;
}
export function cupTeamKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Leading seeds: 2024 podium/order and 2026 group draw, FIP 1 November 2026.
// https://www.padelfip.com/2026/11/group-stage-drawn-as-the-race-for-the-world-title-begins-in-doha-on-monday/
// Do not assign seed numbers to the remaining countries without an official list.
export function cupSeed(country: string | null, category: CupCategory): number | null {
  const order = category === 'men' ? ['AR', 'ES', 'PT', 'IT'] : ['ES', 'AR', 'IT', 'PT'];
  const index = order.indexOf(normalizeCountry(country) ?? '');
  return index < 0 ? null : index + 1;
}

export const WORLD_CUP_ID = '2c1a0800-3bd6-424c-92f1-5417fea2cba1';
export const WORLD_CUP_EVENT_URL = 'https://www.padelfip.com/es/eventos/fip-world-cup-2026-2/';
export function isWorldCupActive(now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  return day >= '2026-11-02' && day <= '2026-11-08';
}

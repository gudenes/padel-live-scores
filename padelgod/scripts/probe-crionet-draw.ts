/**
 * Probe a Crionet draw widget to see whether the bracket has been
 * published yet. Reports HTTP status, table presence, and team cell
 * count. Useful for verifying when the draw-fetcher will start
 * producing data for a tournament.
 *
 *   npx tsx scripts/probe-crionet-draw.ts <widgetCode> [MD|WD|MQ|WQ] [64|32|16]
 *   npx tsx scripts/probe-crionet-draw.ts FIP-2026-2209 MD 64
 */

const widget = process.argv[2];
const drawType = process.argv[3] ?? 'MD';
const round = process.argv[4] ?? '64';

if (!widget) {
  console.error('Usage: probe-crionet-draw.ts <widgetCode> [MD|WD|MQ|WQ] [round]');
  process.exit(1);
}

const url = `https://widget.matchscorerlive.com/screen/draw/${widget}/${drawType}/${round}?t=tol`;
console.log(`GET ${url}`);

const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 PadelNachos/probe' } });
const html = await resp.text();
console.log(`Status: ${resp.status}, body: ${html.length} bytes`);

const tableCount = (html.match(/<table[^>]*class="w-100"/gi) ?? []).length;
const teamCells = (html.match(/<td[^>]*class="team"/gi) ?? []).length;
const drawTypeNames = [...html.matchAll(/class="page-link[^"]*">([^<]+)<\/a>/g)].map(m => m[1]);
const roundNames = [...html.matchAll(/round-name">([^<]+)</g)].map(m => m[1]);

console.log(`Bracket tables:  ${tableCount}`);
console.log(`Team cells (<td.team>): ${teamCells}`);
console.log(`Draw types in nav:    ${drawTypeNames.join(', ') || '(none)'}`);
console.log(`Round headers:        ${roundNames.join(', ') || '(none)'}`);

if (teamCells > 0) {
  console.log('\nVERDICT: Draw is PUBLISHED. fip-draw-populator will INSERT matches on its next run (hourly :47).');
} else if (tableCount === 0 && roundNames.length > 0) {
  console.log('\nVERDICT: Bracket structure exists but no teams yet — Crionet has not published this draw.');
} else if (resp.status !== 200) {
  console.log('\nVERDICT: HTTP error — widget URL not reachable.');
} else {
  console.log('\nVERDICT: Unexpected HTML — inspect manually.');
}

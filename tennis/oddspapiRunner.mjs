// oddspapiRunner.mjs — pull real historical total-games lines, join to outcomes, run the edge scan.
// Run:  ODDSPAPI_KEY=xxxxx node tennis/oddspapiRunner.mjs ./data/tennis
// (needs the CSVs in ./data/tennis for outcomes, and your OddsPapi key in the env)
//
// This is the actual edge VALIDATOR: against real lines the base is ~50%, so any condition well
// above that is a genuine total-games edge. Free tier = 250 req/month, so it paginates tournaments
// and stops early; widen the range once you've confirmed it works.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, normalizeTotals, consensusLine } from './oddspapiClient.mjs';
import { buildRowsFromCsv } from './tennisFeed.js';
import { scanTotalGames } from './tennisTotalGamesScan.js';

const KEY = process.env.ODDSPAPI_KEY;
const dataDir = process.argv[2] || './data/tennis';
const MAX_TOURNAMENTS = Number(process.env.MAX_TOURNAMENTS || 8); // quota guard

async function main() {
  if (!KEY) { console.error('Set ODDSPAPI_KEY in the environment.'); process.exit(1); }
  const api = makeClient(KEY, { bookmaker: 'pinnacle' });

  // 1. resolve IDs by name (robust to their numeric ids)
  const sportId = await api.resolveTennisSportId();
  let totalsMarketId = null;
  try { totalsMarketId = await api.resolveTotalGamesMarketId(); } catch { /* fallback scan handles it */ }
  console.error(`tennis sportId=${sportId} totalsMarketId=${totalsMarketId ?? '(auto-scan)'}`);

  // 2. tournaments → pull odds (historical if your plan supports the param; else current)
  const tournaments = await api.getTournaments(sportId);
  const tlist = (Array.isArray(tournaments) ? tournaments : tournaments?.data || []).slice(0, MAX_TOURNAMENTS);
  const ids = tlist.map((t) => t.tournamentId ?? t.id).filter(Boolean);
  console.error(`pulling odds for ${ids.length} tournaments (quota guard=${MAX_TOURNAMENTS})`);

  const fixtures = await api.getOddsByTournaments(ids);
  const flist = Array.isArray(fixtures) ? fixtures : fixtures?.data || [];

  // 3. resolve participant names, normalize to line records
  const partIds = [...new Set(flist.flatMap((f) => [f.participant1Id, f.participant2Id]).filter(Boolean))];
  let nameOf = {};
  try {
    const parts = await api.getParticipants(partIds);
    for (const p of (Array.isArray(parts) ? parts : parts?.data || [])) nameOf[p.participantId ?? p.id] = p.name;
  } catch { /* names may already be on fixtures */ }

  const lineRecords = [];
  for (const f of flist) {
    const totals = normalizeTotals(f, totalsMarketId);
    const line = consensusLine(totals);
    if (line == null) continue;
    lineRecords.push({
      date: (f.startTime || '').slice(0, 10),
      playerA: nameOf[f.participant1Id] || f.participant1Name || f.participant1Id,
      playerB: nameOf[f.participant2Id] || f.participant2Name || f.participant2Id,
      line,
    });
  }
  console.error(`normalized ${lineRecords.length} total-games line records`);

  // 4. load Sackmann outcomes
  const files = readdirSync(dataDir).filter((f) => /_matches_.*\.csv$/i.test(f));
  let rows = [];
  for (const f of files) rows = rows.concat(buildRowsFromCsv(readFileSync(join(dataDir, f), 'utf8')));

  // 5. scan
  const res = scanTotalGames(lineRecords, rows);
  console.log(`\njoined ${res.matches} matches to real lines\n`);
  console.log('SIGNAL' + ' '.repeat(42) + 'n     hit%   lift    edge?');
  for (const s of res.signals) {
    const lift = s.lift == null ? '  —' : ((s.lift >= 0 ? '+' : '') + (s.lift * 100).toFixed(1)).padStart(6);
    console.log(`${s.name.padEnd(46)} ${String(s.n).padStart(4)}  ${s.rate == null ? ' —' : (s.rate * 100).toFixed(1).padStart(5)}  ${lift}   ${s.edge ? 'YES ✅' : ''}`);
  }
  console.log('\nAgainst real lines the base is ~50%, so a high-lift condition is a genuine edge.');
  if (!res.matches) console.log('0 joins — likely name-format mismatch between OddsPapi and Sackmann, or historical param needs setting. Tell me the first few OddsPapi player names printed and I\'ll tune the matcher.');
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

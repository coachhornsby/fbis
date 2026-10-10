// Local files only: no network, credentials, D1, provider or production writes.
import { readFile } from 'node:fs/promises';
import { scanGame, evaluatePattern, PATTERNS, gradeSpread } from '../research/situational/discovery.mjs';
import { parseCsv } from '../functions/lib/nflVerseFeed.js';

export function descriptiveNFL(csv, startSeason = 2016, endSeason = 2025) {
  const rows = parseCsv(csv).filter(r => r.game_type === 'REG' && Number(r.season) >= startSeason && Number(r.season) <= endSeason && r.home_score !== '' && r.away_score !== '' && /^\d+$/.test(r.home_score) && /^\d+$/.test(r.away_score))
    .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.game_id.localeCompare(b.game_id));
  const records = new Map(), results = {};
  for (const r of rows) {
    for (const side of ['HOME', 'AWAY']) {
      const home = side === 'HOME', team = home ? r.home_team : r.away_team;
      const key = `${r.season}:${team}`, prior = records.get(key) || { games: 0, wins: 0 };
      const restText = home ? r.home_rest : r.away_rest, oppText = home ? r.away_rest : r.home_rest;
      const rest = /^\d+$/.test(restText) ? Number(restText) : null, opp = /^\d+$/.test(oppText) ? Number(oppText) : null;
      const matching = [];
      if (rest !== null && opp !== null && rest < opp) matching.push('rest-disadvantage');
      if (rest !== null && rest <= 5) matching.push('short-rest');
      if (prior.games >= 3 && prior.wins === 0) matching.push('winless-after-three');
      const line = r.spread_line !== '' && Number.isFinite(Number(r.spread_line)) ? Number(r.spread_line) * (home ? -1 : 1) : null;
      const grade = line === null ? null : gradeSpread({ side, line, homeScore: Number(r.home_score), awayScore: Number(r.away_score) });
      for (const p of matching) {
        const cohort = results[`${r.season}:${p}`] ||= { season: Number(r.season), pattern: p, teamGames: 0, straightUpWins: 0, straightUpLosses: 0, straightUpTies: 0, atsWins: 0, atsLosses: 0, pushes: 0, missingLine: 0 };
        cohort.teamGames++;
        const margin = (Number(r.home_score) - Number(r.away_score)) * (home ? 1 : -1);
        cohort[margin > 0 ? 'straightUpWins' : margin < 0 ? 'straightUpLosses' : 'straightUpTies']++;
        if (!grade) cohort.missingLine++; else cohort[grade.ats === 'WIN' ? 'atsWins' : grade.ats === 'LOSS' ? 'atsLosses' : 'pushes']++;
      }
    }
    for (const home of [true, false]) {
      const key = `${r.season}:${home ? r.home_team : r.away_team}`, prior = records.get(key) || { games: 0, wins: 0 };
      const won = home ? Number(r.home_score) > Number(r.away_score) : Number(r.away_score) > Number(r.home_score);
      records.set(key, { games: prior.games + 1, wins: prior.wins + Number(won) });
    }
  }
  return { mode: 'RETROSPECTIVE_UNVERIFIED', source: 'nflverse games.csv', games: rows.length,
    qualification: 'BLOCKED', limitations: ['no-bookmaker', 'no-original-quote-clock', 'no-original-data-availability-proof', 'team-game-cohorts-overlap', 'no-statistical-or-economic-validation'], cohorts: Object.values(results) };
}

if (process.argv[1]?.endsWith('/situational-discovery.mjs')) {
  const [mode, input] = process.argv.slice(2);
  if (!input || !['shadow', 'validate', 'nfl-descriptive'].includes(mode)) throw new Error('Usage: node scripts/situational-discovery.mjs shadow|validate|nfl-descriptive LOCAL_FILE');
  const body = await readFile(input, 'utf8');
  let result;
  if (mode === 'nfl-descriptive') result = descriptiveNFL(body);
  else {
    const fixture = JSON.parse(body);
    result = mode === 'shadow' ? fixture.games.map(g => scanGame(g, fixture.contract)) :
      PATTERNS.map(pattern => evaluatePattern(fixture.rows, { ...fixture.analysisPlan, pattern }));
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

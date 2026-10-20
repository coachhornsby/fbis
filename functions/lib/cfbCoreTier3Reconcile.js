/**
 * Reconcile FBIS Tier3 weekly training CSVs (EPA feature docs) with archived
 * CFBD `/ratings/core` throughWeek coverage. Sources remain distinct.
 * Research-only — never promotes production.
 */

import { schoolKey } from "./cfbdCanonical.js";
import { CORE_DATA_SOURCE, FBIS_WEEKLY_TRAINING_FIRST_SEASON } from "./cfbCoreHistorical.js";
import { indexCoreArchivesBySeasonWeek } from "./cfbCoreHoldout.js";

/**
 * Parse Tier3-style CSV text into game rows (header-driven).
 * Expected columns include season/week/home/away (flexible names).
 */
export function parseTier3TrainingCsv(text = "", { defaultSeason = null, defaultWeek = null } = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], header: [] };
  const header = splitCsvLine(lines[0]).map((h) => String(h || "").trim());
  const idx = (names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSeason = idx(["season", "year"]);
  const iWeek = idx(["week", "slate_week", "schedule_week"]);
  const iHome = idx(["home_team", "home", "home_team_source", "homeTeam"]);
  const iAway = idx(["away_team", "away", "away_team_source", "awayTeam"]);
  const iGame = idx(["game_id", "id", "gameId"]);
  const iKick = idx(["kickoff", "kickoff_literal", "start_date", "startDate"]);
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    if (!cols.length) continue;
    const home = iHome >= 0 ? cols[iHome] : null;
    const away = iAway >= 0 ? cols[iAway] : null;
    if (!home || !away) continue;
    rows.push({
      gameId: iGame >= 0 ? String(cols[iGame] || "") : null,
      season: iSeason >= 0 ? Number(cols[iSeason]) : defaultSeason,
      week: iWeek >= 0 ? Number(cols[iWeek]) : defaultWeek,
      homeTeam: home,
      awayTeam: away,
      kickoff: iKick >= 0 ? cols[iKick] : null,
      homeKey: schoolKey(home),
      awayKey: schoolKey(away),
      source: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    });
  }
  return { rows, header };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Compare Tier3 game teams against CORE archive coverage for the same season/week.
 * CORE feature for a schedule week W requires throughWeek < W (typically W-1).
 */
export function reconcileTier3WithCoreArchives({
  tier3Games = [],
  archiveRows = [],
  firstWeeklyDocSeason = FBIS_WEEKLY_TRAINING_FIRST_SEASON,
} = {}) {
  const { bySeason, coverage } = indexCoreArchivesBySeasonWeek(archiveRows);
  const bySeasonWeek = {};
  const gaps = [];
  let matched = 0;
  let missingCoreWeek = 0;
  let missingTeam = 0;
  let skippedPreFirst = 0;

  for (const g of tier3Games || []) {
    const season = Number(g.season);
    const week = Number(g.week);
    if (!Number.isFinite(season) || !Number.isFinite(week)) continue;
    if (season < firstWeeklyDocSeason) {
      skippedPreFirst += 1;
      continue;
    }
    const key = `${season}:${week}`;
    if (!bySeasonWeek[key]) {
      bySeasonWeek[key] = {
        season,
        week,
        tier3Games: 0,
        bothTeamsInCore: 0,
        missingCoreThroughWeek: 0,
        missingTeam: 0,
      };
    }
    bySeasonWeek[key].tier3Games += 1;

    const available = Object.keys(bySeason[season] || {})
      .map(Number)
      .filter((w) => w > 0 && w < week)
      .sort((a, b) => b - a);
    const throughWeek = available[0] ?? null;
    if (throughWeek == null) {
      missingCoreWeek += 1;
      bySeasonWeek[key].missingCoreThroughWeek += 1;
      gaps.push({
        gameId: g.gameId,
        season,
        week,
        reason: "no_core_throughWeek_lt_gameWeek",
      });
      continue;
    }
    const bucket = bySeason[season][throughWeek] || {};
    const homeOk = Boolean(bucket[g.homeKey || schoolKey(g.homeTeam)]);
    const awayOk = Boolean(bucket[g.awayKey || schoolKey(g.awayTeam)]);
    if (homeOk && awayOk) {
      matched += 1;
      bySeasonWeek[key].bothTeamsInCore += 1;
    } else {
      missingTeam += 1;
      bySeasonWeek[key].missingTeam += 1;
      gaps.push({
        gameId: g.gameId,
        season,
        week,
        throughWeek,
        reason: "core_team_coverage_gap",
        homeOk,
        awayOk,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
      });
    }
  }

  return {
    sourcesRemainDistinct: [
      CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
      CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API,
    ],
    note: "Tier3 CSVs carry EPA/feature docs; CORE archives are CFBD /ratings/core throughWeek rows.",
    coreCoverage: coverage,
    tier3GameCount: (tier3Games || []).length,
    matchedBothTeamsInCore: matched,
    missingCoreThroughWeek: missingCoreWeek,
    missingTeamInCore: missingTeam,
    skippedPreFirstWeeklyDocSeason: skippedPreFirst,
    bySeasonWeek: Object.values(bySeasonWeek).sort(
      (a, b) => a.season - b.season || a.week - b.week
    ),
    sampleGaps: gaps.slice(0, 25),
    ok: matched > 0 && missingCoreWeek === 0,
    researchOnly: true,
  };
}

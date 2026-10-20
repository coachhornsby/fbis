/**
 * Reconstruct FBIS CORE weekly team-strength archives from preserved weekly
 * training reports (Tier3 CSVs with adjusted EPA offense/defense).
 *
 * This is the primary FBIS CORE research methodology path. CFBD `/ratings/core`
 * remains an optional external overlay — not a hard dependency.
 *
 * Mapping (FBIS approximation, not CFBD published CORE):
 *   offense = adjusted_epa * 100          (per-100-play scale)
 *   defense = -(adjusted_epa_allowed * 100) (CFBD-like sign: lower/more-negative = better D)
 *   overall = offense + defense
 *
 * Cutoff: a report labeled schedule week W carries pregame features through
 * statistical week W-1 → archive throughWeek = W - 1.
 *
 * Research-only. Never promotes champion A/A or authorizes wagers.
 */

import { schoolKey } from "./cfbdCanonical.js";
import {
  CORE_AUTHENTICITY,
  CORE_DATA_SOURCE,
  CORE_HISTORICAL_VERSION,
  FBIS_WEEKLY_TRAINING_FIRST_SEASON,
} from "./cfbCoreHistorical.js";

export const FBIS_CORE_FROM_WEEKLY_VERSION = "fbis-core-from-weekly-reports-v1";
/** Endpoint tag accepted by buildCfbCoreMatchupVector for weekly-doc CORE. */
export const FBIS_CORE_WEEKLY_SOURCE_ENDPOINT = "fbis_weekly_training_document";
export const FBIS_CORE_EPA_SCALE = 100;

const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function describeFbisCoreFromWeeklyReports() {
  return {
    version: FBIS_CORE_FROM_WEEKLY_VERSION,
    historicalVersion: CORE_HISTORICAL_VERSION,
    primarySource: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    optionalOverlay: CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API,
    authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
    sourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
    firstSeason: FBIS_WEEKLY_TRAINING_FIRST_SEASON,
    mapping: {
      offense: "adjusted_epa * 100",
      defense: "-(adjusted_epa_allowed * 100)",
      overall: "offense + defense",
      note: "FBIS approximation from weekly training docs; distinct from CFBD precomputed CORE",
    },
    cutoff: {
      rule: "report_schedule_week_W_implies_throughWeek_W_minus_1",
      verify: "throughWeek < gameWeek",
    },
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Map one side's adjusted EPA pair into CORE-like offense/defense/overall.
 */
export function mapAdjustedEpaToFbisCore({ adjustedEpa, adjustedEpaAllowed, scale = FBIS_CORE_EPA_SCALE } = {}) {
  const off = n(adjustedEpa);
  const allowed = n(adjustedEpaAllowed);
  if (off == null || allowed == null) {
    return { ok: false, offense: null, defense: null, overall: null };
  }
  const s = Number(scale) > 0 ? Number(scale) : FBIS_CORE_EPA_SCALE;
  const offense = off * s;
  const defense = -(allowed * s);
  return {
    ok: true,
    offense,
    defense,
    overall: offense + defense,
    rawAdjustedEpa: off,
    rawAdjustedEpaAllowed: allowed,
    scale: s,
  };
}

function splitCsvLineClean(line) {
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
 * Parse a weekly training CSV into game rows with EPA feature columns.
 */
export function parseWeeklyTrainingReportCsv(
  text = "",
  { defaultSeason = null, defaultWeek = null } = {}
) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], header: [], scheduleWeek: defaultWeek, season: defaultSeason };

  const header = splitCsvLineClean(lines[0]).map((h) => String(h || "").trim());
  const idx = (names) => {
    for (const name of names) {
      const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSeason = idx(["season", "year"]);
  const iWeek = idx(["week", "slate_week", "schedule_week"]);
  const iHome = idx(["home_team", "home", "homeTeam"]);
  const iAway = idx(["away_team", "away", "awayTeam"]);
  const iGame = idx(["id", "game_id", "gameId"]);
  const iKick = idx(["start_date", "kickoff", "startDate"]);
  const iNeutral = idx(["neutral_site", "neutralSite"]);
  const iHomeConf = idx(["home_conference", "homeConference"]);
  const iAwayConf = idx(["away_conference", "awayConference"]);
  const iHomeEpa = idx(["home_adjusted_epa"]);
  const iHomeEpaAll = idx(["home_adjusted_epa_allowed"]);
  const iAwayEpa = idx(["away_adjusted_epa"]);
  const iAwayEpaAll = idx(["away_adjusted_epa_allowed"]);
  const iHomeElo = idx(["home_elo"]);
  const iAwayElo = idx(["away_elo"]);
  const iSpread = idx(["spread"]);

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLineClean(lines[r]);
    if (!cols.length) continue;
    const home = iHome >= 0 ? cols[iHome] : null;
    const away = iAway >= 0 ? cols[iAway] : null;
    if (!home || !away) continue;
    const season = iSeason >= 0 ? n(cols[iSeason]) : defaultSeason;
    const week = iWeek >= 0 ? n(cols[iWeek]) : defaultWeek;
    const neutralRaw = iNeutral >= 0 ? String(cols[iNeutral] || "").toLowerCase() : "";
    rows.push({
      gameId: iGame >= 0 ? String(cols[iGame] || "") : null,
      season,
      week,
      kickoff: iKick >= 0 ? cols[iKick] : null,
      homeTeam: home,
      awayTeam: away,
      homeConference: iHomeConf >= 0 ? cols[iHomeConf] || null : null,
      awayConference: iAwayConf >= 0 ? cols[iAwayConf] || null : null,
      neutralSite: neutralRaw === "true" || neutralRaw === "1",
      homeKey: schoolKey(home),
      awayKey: schoolKey(away),
      homeAdjustedEpa: iHomeEpa >= 0 ? n(cols[iHomeEpa]) : null,
      homeAdjustedEpaAllowed: iHomeEpaAll >= 0 ? n(cols[iHomeEpaAll]) : null,
      awayAdjustedEpa: iAwayEpa >= 0 ? n(cols[iAwayEpa]) : null,
      awayAdjustedEpaAllowed: iAwayEpaAll >= 0 ? n(cols[iAwayEpaAll]) : null,
      homeElo: iHomeElo >= 0 ? n(cols[iHomeElo]) : null,
      awayElo: iAwayElo >= 0 ? n(cols[iAwayElo]) : null,
      spread: iSpread >= 0 ? n(cols[iSpread]) : null,
      source: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    });
  }

  const scheduleWeek =
    defaultWeek ??
    (rows.find((r) => r.week != null)?.week ?? null);
  const season =
    defaultSeason ??
    (rows.find((r) => r.season != null)?.season ?? null);

  return { rows, header, scheduleWeek, season };
}

/**
 * From one weekly report (schedule week W), build team archive rows for throughWeek W-1.
 * When a team appears on multiple slate rows, average their EPA-derived ratings.
 */
export function buildFbisCoreArchiveFromWeeklyReport({
  scheduleWeek,
  season,
  gameRows = [],
  collectionTime = null,
  scale = FBIS_CORE_EPA_SCALE,
} = {}) {
  const week = n(scheduleWeek);
  const yr = n(season);
  if (week == null || week < 2 || yr == null) {
    return {
      ok: false,
      reason: "invalid_season_or_schedule_week",
      throughWeek: null,
      teams: [],
    };
  }
  const throughWeek = week - 1;
  const accum = new Map();

  const ingest = (teamName, epa, epaAllowed) => {
    const key = schoolKey(teamName);
    if (!key) return;
    const mapped = mapAdjustedEpaToFbisCore({
      adjustedEpa: epa,
      adjustedEpaAllowed: epaAllowed,
      scale,
    });
    if (!mapped.ok) return;
    const prev = accum.get(key) || {
      schoolKey: key,
      team: teamName,
      offenseSum: 0,
      defenseSum: 0,
      overallSum: 0,
      n: 0,
    };
    prev.offenseSum += mapped.offense;
    prev.defenseSum += mapped.defense;
    prev.overallSum += mapped.overall;
    prev.n += 1;
    accum.set(key, prev);
  };

  for (const g of gameRows || []) {
    ingest(g.homeTeam, g.homeAdjustedEpa, g.homeAdjustedEpaAllowed);
    ingest(g.awayTeam, g.awayAdjustedEpa, g.awayAdjustedEpaAllowed);
  }

  const asOf =
    collectionTime ||
    inferCollectionTimeFromKickoffs(
      (gameRows || []).map((g) => g.kickoff).filter(Boolean),
      throughWeek,
      yr
    );

  const teams = [...accum.values()]
    .map((t) => ({
      schoolKey: t.schoolKey,
      team: t.team,
      core: t.overallSum / t.n,
      coreOffense: t.offenseSum / t.n,
      coreDefense: t.defenseSum / t.n,
      observations: t.n,
      throughSeasonType: "regular",
      coreSourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
    }))
    .sort((a, b) => a.schoolKey.localeCompare(b.schoolKey));

  return {
    ok: teams.length > 0,
    version: FBIS_CORE_FROM_WEEKLY_VERSION,
    season: yr,
    scheduleWeek: week,
    throughWeek,
    authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
    dataSource: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    sourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
    collectionTime: asOf,
    teams,
    teamCount: teams.length,
    researchOnly: true,
  };
}

function inferCollectionTimeFromKickoffs(kickoffs = [], throughWeek, season) {
  let minMs = Infinity;
  for (const k of kickoffs) {
    const ms = Date.parse(String(k).includes("T") ? String(k) : String(k).replace(" ", "T") + "Z");
    if (Number.isFinite(ms) && ms < minMs) minMs = ms;
  }
  if (Number.isFinite(minMs) && minMs < Infinity) {
    // Features are pregame — stamp collection one hour before earliest slate kickoff.
    return new Date(minMs - 60 * 60 * 1000).toISOString();
  }
  // Deterministic fallback when kickoffs missing.
  const month = Math.min(12, Math.max(8, 8 + Math.floor((throughWeek || 1) / 4)));
  const day = Math.min(28, Math.max(1, ((throughWeek || 1) % 4) * 7 + 1));
  return `${season}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z`;
}

/**
 * Convert archive payload teams into flat rows for indexCoreArchivesBySeasonWeek.
 */
export function fbisCoreArchiveToHoldoutRows(archive) {
  if (!archive?.ok || !archive.teams?.length) return [];
  return archive.teams.map((t) => ({
    season: archive.season,
    through_week: archive.throughWeek,
    school_key: t.schoolKey,
    team: t.team,
    core: t.core,
    core_offense: t.coreOffense,
    core_defense: t.coreDefense,
    through_season_type: t.throughSeasonType || "regular",
    collection_time: archive.collectionTime,
    authenticityClass: archive.authenticityClass,
    coreSourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
    dataSource: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
  }));
}

/**
 * Reconstruct weekly FBIS CORE archives from a map of {season → {week → csvText}}
 * or an array of {season, week, text|rows}.
 */
export function reconstructFbisCoreFromWeeklyReports(reports = [], { scale = FBIS_CORE_EPA_SCALE } = {}) {
  const archives = [];
  const archiveRows = [];
  const errors = [];

  for (const report of reports || []) {
    const season = n(report.season);
    const week = n(report.week ?? report.scheduleWeek);
    let rows = report.rows || null;
    if (!rows && report.text != null) {
      const parsed = parseWeeklyTrainingReportCsv(report.text, {
        defaultSeason: season,
        defaultWeek: week,
      });
      rows = parsed.rows;
    }
    if (!rows?.length) {
      errors.push({ season, week, reason: "empty_report" });
      continue;
    }
    if (season != null && season < FBIS_WEEKLY_TRAINING_FIRST_SEASON) {
      errors.push({ season, week, reason: "before_first_weekly_training_season" });
      continue;
    }
    const archive = buildFbisCoreArchiveFromWeeklyReport({
      scheduleWeek: week ?? rows[0]?.week,
      season: season ?? rows[0]?.season,
      gameRows: rows,
      collectionTime: report.collectionTime || null,
      scale,
    });
    if (!archive.ok) {
      errors.push({ season, week, reason: archive.reason || "archive_build_failed" });
      continue;
    }
    archives.push(archive);
    archiveRows.push(...fbisCoreArchiveToHoldoutRows(archive));
  }

  const bySeason = {};
  for (const a of archives) {
    if (!bySeason[a.season]) bySeason[a.season] = [];
    bySeason[a.season].push(a.throughWeek);
  }
  const coverage = Object.keys(bySeason)
    .map(Number)
    .sort((a, b) => a - b)
    .map((season) => {
      const weeks = [...new Set(bySeason[season])].sort((a, b) => a - b);
      return {
        season,
        throughWeeks: weeks,
        distinctThroughWeeks: weeks.length,
        teamCounts: Object.fromEntries(
          weeks.map((w) => [
            w,
            archives.find((x) => x.season === season && x.throughWeek === w)?.teamCount || 0,
          ])
        ),
      };
    });

  return {
    ok: archives.length > 0,
    version: FBIS_CORE_FROM_WEEKLY_VERSION,
    design: describeFbisCoreFromWeeklyReports(),
    archives,
    archiveRows,
    coverage,
    errors,
    authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
    dataSource: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

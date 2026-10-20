#!/usr/bin/env node
/**
 * Build & evaluate FBIS CORE from weekly training reports (Tier3 CSVs).
 *
 * Primary path — does NOT require CFBD `/ratings/core`.
 *   2025 weekly reports → reconstruct team-strength archives → fit Model C
 *   2026 weekly reports → frozen holdout features
 *   Evaluate vs champion A/A on untouched 2026 games
 *
 * Env:
 *   CFB_HOLDOUT_TIER3_2025   — dir of 2025 week*.csv (default /opt/cursor/artifacts/tier3-csv-2025)
 *   CFB_HOLDOUT_TIER3_2026   — dir of 2026 week*.csv (default /opt/cursor/artifacts/tier3-csv-2026)
 *   CFB_HOLDOUT_GAMES        — JSON/JSONL scored games (required unless CFBD_API_KEY set)
 *   CFB_HOLDOUT_BASELINES    — JSON/JSONL A/A baselines {gameId,baselineHome,baselineAway}
 *   CFBD_API_KEY             — optional: fetch scored games + SP→FBIS-v2 baselines
 *   CFB_HOLDOUT_BUILD_SP_BASELINES=1 — build SP baselines when A/A file missing (needs CFBD)
 *   CFB_HOLDOUT_OUT          — report path
 *
 * Research-only. Production A/A and wagering unchanged.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import { schoolKey } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
import {
  reconstructFbisCoreFromWeeklyReports,
  parseWeeklyTrainingReportCsv,
  describeFbisCoreFromWeeklyReports,
  FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
} from "../functions/lib/cfbCoreFromWeeklyReports.js";
import {
  describeCoreHoldoutEvalDesign,
  runCore2025Train2026HoldoutReport,
  indexCoreArchivesBySeasonWeek,
  CORE_HOLDOUT_TRAIN_SEASON,
  CORE_HOLDOUT_EVAL_SEASON,
} from "../functions/lib/cfbCoreHoldout.js";
import { CORE_AUTHENTICITY } from "../functions/lib/cfbCoreHistorical.js";

const outPath = resolve(
  process.env.CFB_HOLDOUT_OUT ||
    "artifacts/cfb-core-fbis-from-weekly-reports-holdout-report.json"
);

function loadJsonOrJsonl(path) {
  if (!path || !existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  if (content.trimStart().startsWith("[")) return JSON.parse(content);
  return content
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWeeklyReportsFromDir(dir, defaultSeason) {
  if (!dir || !existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /\.csv$/i.test(f))
    .sort();
  const reports = [];
  for (const f of files) {
    const m = f.match(/week[_-]?(\d{1,2})/i);
    const week = m ? Number(m[1]) : null;
    const seasonMatch = f.match(/(20\d{2})/);
    const season = seasonMatch ? Number(seasonMatch[1]) : defaultSeason;
    const text = readFileSync(join(dir, f), "utf8");
    const parsed = parseWeeklyTrainingReportCsv(text, {
      defaultSeason: season,
      defaultWeek: week,
    });
    reports.push({
      season: season ?? parsed.season,
      week: week ?? parsed.scheduleWeek,
      text,
      rows: parsed.rows,
      filename: f,
    });
  }
  return reports;
}

function attachBaselines(games, baselineRows) {
  if (!baselineRows?.length) {
    return games.map((g) => ({ ...g, baselineSource: g.baselineSource || null }));
  }
  const byId = new Map();
  const byMatchup = new Map();
  for (const b of baselineRows) {
    const id = String(b.gameId || b.id || "");
    if (id) byId.set(id, b);
    const hk = schoolKey(b.homeTeam || b.home || "");
    const ak = schoolKey(b.awayTeam || b.away || "");
    const season = Number(b.season);
    const week = Number(b.week);
    if (hk && ak && Number.isFinite(season)) {
      byMatchup.set(`${season}:${week || ""}:${hk}:${ak}`, b);
    }
  }
  return games.map((g) => {
    if (g.baselineHome != null && g.baselineAway != null) {
      return { ...g, baselineSource: g.baselineSource || "provided" };
    }
    const b =
      byId.get(String(g.gameId)) ||
      byMatchup.get(`${g.season}:${g.week}:${schoolKey(g.homeTeam)}:${schoolKey(g.awayTeam)}`);
    if (!b) return { ...g, baselineSource: null };
    return {
      ...g,
      baselineHome: b.baselineHome ?? b.championHome ?? b.proj_home ?? b.home,
      baselineAway: b.baselineAway ?? b.championAway ?? b.proj_away ?? b.away,
      baselineSource: b.baselineSource || b.source || "baseline_file",
      championModelId: b.championModelId || b.model_version || null,
    };
  });
}

async function fetchSeasonGames(env, season) {
  const games = [];
  let errors = 0;
  const res = await cfbdGet("/games", env, {
    query: { year: season, seasonType: "regular" },
    skipCache: true,
  });
  if (!res?.ok) return { games, errors: 1 };
  for (const g of res.data || []) {
    const week = Number(g.week);
    if (!Number.isFinite(week) || week < 1 || week > 15) continue;
    const actualHome = g.homePoints ?? g.home_points;
    const actualAway = g.awayPoints ?? g.away_points;
    games.push({
      gameId: String(g.id),
      season,
      week,
      kickoff: g.startDate || g.start_date,
      homeTeam: g.homeTeam || g.home_team,
      awayTeam: g.awayTeam || g.away_team,
      homeConference: g.homeConference || g.home_conference,
      awayConference: g.awayConference || g.away_conference,
      neutralSite: Boolean(g.neutralSite || g.neutral_site),
      actualHome: actualHome == null ? null : Number(actualHome),
      actualAway: actualAway == null ? null : Number(actualAway),
      finalVerified: actualHome != null && actualAway != null,
      finalAt: g.startDate
        ? new Date(Date.parse(g.startDate) + 5 * 60 * 60 * 1000).toISOString()
        : null,
    });
  }
  return { games, errors };
}

async function fetchSpIndex(env, season) {
  const res = await cfbdGet("/ratings/sp", env, { query: { year: season }, skipCache: true });
  if (!res?.ok || !Array.isArray(res.data)) return {};
  const byTeam = {};
  for (const row of res.data) {
    const key = schoolKey(row.team || row.school);
    if (!key) continue;
    byTeam[key] = {
      offense: Number(row.offense?.rating ?? row.offense ?? row.o),
      defense: Number(row.defense?.rating ?? row.defense ?? row.d),
    };
  }
  return byTeam;
}

function buildSpChampionBaselines(games, spBySeason) {
  const out = [];
  let ok = 0;
  let fail = 0;
  for (const g of games) {
    const sp = spBySeason[g.season] || {};
    const home = sp[schoolKey(g.homeTeam)];
    const away = sp[schoolKey(g.awayTeam)];
    if (!home || !away || ![home.offense, home.defense, away.offense, away.defense].every(Number.isFinite)) {
      fail += 1;
      continue;
    }
    const proj = projectCfbFbisV2({
      sport: "cfb",
      home: { name: g.homeTeam },
      away: { name: g.awayTeam },
      neutralSite: Boolean(g.neutralSite),
      featureCutoffOk: true,
      cfbFbisV2Input: {
        home: {
          priorOff: home.offense,
          priorDef: home.defense,
          spOffense: home.offense,
          spDefense: home.defense,
          gamesPlayed: Math.max(0, (g.week || 1) - 1),
        },
        away: {
          priorOff: away.offense,
          priorDef: away.defense,
          spOffense: away.offense,
          spDefense: away.defense,
          gamesPlayed: Math.max(0, (g.week || 1) - 1),
        },
        neutralSite: Boolean(g.neutralSite),
      },
    });
    if (!proj?.ok) {
      fail += 1;
      continue;
    }
    ok += 1;
    out.push({
      gameId: g.gameId,
      season: g.season,
      week: g.week,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      baselineHome: proj.home,
      baselineAway: proj.away,
      baselineSource: "cfb_fbis_v2_sp_prior_retrospective",
      championModelId: CFB_FBIS_V2_ID,
    });
  }
  return { baselines: out, ok, fail };
}

async function main() {
  const design = describeCoreHoldoutEvalDesign();
  const fbisDesign = describeFbisCoreFromWeeklyReports();
  const dir2025 =
    process.env.CFB_HOLDOUT_TIER3_2025 || "/opt/cursor/artifacts/tier3-csv-2025";
  const dir2026 =
    process.env.CFB_HOLDOUT_TIER3_2026 || "/opt/cursor/artifacts/tier3-csv-2026";

  const reports = [
    ...loadWeeklyReportsFromDir(dir2025, CORE_HOLDOUT_TRAIN_SEASON),
    ...loadWeeklyReportsFromDir(dir2026, CORE_HOLDOUT_EVAL_SEASON),
  ];

  const reconstructed = reconstructFbisCoreFromWeeklyReports(reports);
  const archiveRows = reconstructed.archiveRows;
  const indexed = indexCoreArchivesBySeasonWeek(archiveRows);

  let games = loadJsonOrJsonl(process.env.CFB_HOLDOUT_GAMES) || [];
  const baselines = loadJsonOrJsonl(process.env.CFB_HOLDOUT_BASELINES) || [];
  const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };
  const hasKey = Boolean(env.CFBD_API_KEY);
  let gamesFetch = { usedCfbd: false, errors: 0 };
  let baselineBuild = null;

  if (!games.length && hasKey) {
    gamesFetch.usedCfbd = true;
    for (const season of [CORE_HOLDOUT_TRAIN_SEASON, CORE_HOLDOUT_EVAL_SEASON]) {
      const { games: seasonGames, errors } = await fetchSeasonGames(env, season);
      games = games.concat(seasonGames);
      gamesFetch.errors += errors;
      await sleep(120);
    }
  }

  games = attachBaselines(games, baselines);

  const needBaselines = games.filter((g) => g.baselineHome == null || g.baselineAway == null);
  if (
    needBaselines.length &&
    hasKey &&
    (process.env.CFB_HOLDOUT_BUILD_SP_BASELINES === "1" || !baselines.length)
  ) {
    const spBySeason = {};
    for (const season of [...new Set(needBaselines.map((g) => g.season))]) {
      spBySeason[season] = await fetchSpIndex(env, season);
      await sleep(120);
    }
    baselineBuild = buildSpChampionBaselines(needBaselines, spBySeason);
    games = attachBaselines(games, baselineBuild.baselines);
  }

  const report = runCore2025Train2026HoldoutReport({
    games,
    archiveRows,
    cfbdAccess: hasKey || archiveRows.length > 0,
  });

  report.coreSource = {
    primary: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
    design: fbisDesign,
    authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
    cfbdCoreUsed: false,
    cfbdOptionalForGamesAndSpBaselines: true,
    weeklyReportsLoaded: reports.map((r) => ({
      season: r.season,
      week: r.week,
      filename: r.filename,
      rows: r.rows?.length || 0,
    })),
    reconstruction: {
      ok: reconstructed.ok,
      coverage: reconstructed.coverage,
      archiveRowCount: archiveRows.length,
      errors: reconstructed.errors,
    },
    archiveIndex: indexed.coverage,
  };
  report.gamesFetch = gamesFetch;
  report.baselineBuild = baselineBuild;
  report.holdoutDesign = design;
  report.note =
    "FBIS CORE features reconstructed from weekly training reports; CFBD /ratings/core not used.";

  const archiveOut = resolve("artifacts/cfb-core-fbis-weekly-archives.json");
  mkdirSync(dirname(archiveOut), { recursive: true });
  writeFileSync(archiveOut, JSON.stringify(archiveRows, null, 2) + "\n");
  report.archiveArtifact = archiveOut;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  // Also copy to walkthrough artifacts when present.
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/cfb-core-fbis-from-weekly-reports-holdout-report.json",
      JSON.stringify(report, null, 2) + "\n"
    );
  } catch (_) {}

  console.log(
    JSON.stringify(
      {
        status: report.status,
        blocked: report.blocked,
        classification: report.classification,
        counts: report.counts,
        validationErrors: report.validationErrors,
        blockers: report.blockers,
        coreSource: {
          primary: report.coreSource.primary,
          coverage: report.coreSource.reconstruction.coverage,
          cfbdCoreUsed: false,
        },
        headToHeadVsChampionAA: report.headToHeadVsChampionAA,
        coefficientsFrozen: Boolean(report.coefficients?.frozen),
        holdout2026: report.holdout2026?.metrics || null,
        productionSafeguards: report.productionSafeguards,
        outPath,
      },
      null,
      2
    )
  );

  if (report.blocked || !report.ok) process.exitCode = 3;
}

main().catch((err) => {
  console.error("FBIS_WEEKLY_CORE_HOLDOUT_FATAL:", err?.message || String(err));
  process.exit(2);
});

#!/usr/bin/env node
/**
 * Offline 2025 CORE reconstruction + frozen 2026 Model C holdout.
 *
 * Design (locked):
 *   2025 — construct weekly CORE features, fit coeffs, tune λ via within-2025 CV
 *   2026 — evaluate frozen model only (never refit / retune on 2026)
 *
 * Env:
 *   CFBD_API_KEY          — required for live CFBD reconstruct (optional for --coverage-only)
 *   CFB_HOLDOUT_SEASONS   — default 2025,2026
 *   CFB_HOLDOUT_BASELINES — optional JSON/JSONL of {gameId,baselineHome,baselineAway}
 *   CFB_HOLDOUT_ARCHIVES  — optional JSON of prior archive rows (skip CFBD core fetch)
 *   CFB_HOLDOUT_GAMES     — optional JSON/JSONL of scored games (skip CFBD games fetch)
 *   CFB_HOLDOUT_OUT       — report path (default artifacts/cfb-core-2025-2026-holdout-report.json)
 *
 * Research-only. Does not touch production A/A or wagering.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import {
  buildHistoricalCoreArchivePayloads,
  partitionCoreRowsByThroughWeek,
  CORE_AUTHENTICITY,
} from "../functions/lib/cfbCoreHistorical.js";
import {
  describeCoreHoldoutEvalDesign,
  runCore2025Train2026HoldoutReport,
  auditCoreHoldoutCoverage,
  indexCoreArchivesBySeasonWeek,
  CORE_HOLDOUT_TRAIN_SEASON,
  CORE_HOLDOUT_EVAL_SEASON,
} from "../functions/lib/cfbCoreHoldout.js";

const outPath = resolve(
  process.env.CFB_HOLDOUT_OUT || "artifacts/cfb-core-2025-2026-holdout-report.json"
);
const coverageOnly = process.argv.includes("--coverage-only");
const seasons = (process.env.CFB_HOLDOUT_SEASONS || "2025,2026")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

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

function archiveRowsFromPayloads(payloads = []) {
  const rows = [];
  for (const p of payloads) {
    for (const t of p.teams || []) {
      rows.push({
        season: p.season,
        through_week: p.throughWeek,
        school_key: t.schoolKey,
        core: t.core,
        core_offense: t.coreOffense,
        core_defense: t.coreDefense,
        through_season_type: t.throughSeasonType || "regular",
        collection_time: p.collectionTime,
        authenticityClass: p.authenticityClass,
      });
    }
  }
  return rows;
}

async function fetchCoreYear(env, season) {
  const res = await cfbdGet("/ratings/core", env, { query: { year: season }, skipCache: true });
  if (!res?.ok) throw new Error(res?.reason || `cfbd_/ratings/core_${season}_failed`);
  return res.data || [];
}

async function fetchSeasonGames(env, season) {
  const games = [];
  let errors = 0;
  for (let week = 1; week <= 15; week++) {
    const res = await cfbdGet("/games", env, {
      query: { year: season, week, seasonType: "regular" },
      skipCache: true,
    });
    if (res?.ok && Array.isArray(res.data)) {
      for (const g of res.data) {
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
          actualHome: g.homePoints ?? g.home_points ?? null,
          actualAway: g.awayPoints ?? g.away_points ?? null,
          finalVerified:
            (g.homePoints ?? g.home_points) != null &&
            (g.awayPoints ?? g.away_points) != null &&
            String(g.completed ?? g.complete ?? true) !== "false",
          finalAt: g.startDate
            ? new Date(Date.parse(g.startDate) + 5 * 60 * 60 * 1000).toISOString()
            : null,
        });
      }
    } else if (!res?.ok) {
      errors += 1;
    }
    await sleep(120);
  }
  return { games, errors };
}

function attachBaselines(games, baselineRows) {
  if (!baselineRows?.length) return games;
  const byId = new Map();
  for (const b of baselineRows) {
    const id = String(b.gameId || b.id || "");
    if (!id) continue;
    byId.set(id, b);
  }
  return games.map((g) => {
    const b = byId.get(String(g.gameId));
    if (!b) return g;
    return {
      ...g,
      baselineHome: b.baselineHome ?? b.championHome ?? b.home,
      baselineAway: b.baselineAway ?? b.championAway ?? b.away,
    };
  });
}

async function main() {
  const design = describeCoreHoldoutEvalDesign();
  const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };
  const hasKey = Boolean(env.CFBD_API_KEY);

  let archiveRows = loadJsonOrJsonl(process.env.CFB_HOLDOUT_ARCHIVES) || [];
  let games = loadJsonOrJsonl(process.env.CFB_HOLDOUT_GAMES) || [];
  const baselines = loadJsonOrJsonl(process.env.CFB_HOLDOUT_BASELINES) || [];
  const reconstruct = { seasons: {}, authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED };

  if (coverageOnly) {
    // Live-ish coverage from provided archives only (no network).
    const coverage = auditCoreHoldoutCoverage({
      archiveRows,
      cfbdAccess: hasKey,
      verifiedHistoricalCutoffs: false,
      championBaselinesAvailable: false,
      trainGameCount: 0,
      evalGameCount: 0,
    });
    const report = {
      ok: false,
      blocked: true,
      status: "MODEL_C_BLOCKED",
      reason: "coverage_only_mode",
      generatedAt: new Date().toISOString(),
      design,
      coverage: {
        teamCoverage: coverage.teamCoverage,
        trainCoverage: coverage.trainCoverage,
        evalCoverage: coverage.evalCoverage,
      },
      blockers: coverage.blockers,
      counts: { eligible: 0, train2025: 0, holdout2026: 0 },
      validationErrors: {},
      coefficients: null,
      holdout2026: null,
      headToHeadVsChampionAA: null,
      classification: "Unable to evaluate due to data limitations",
      productionSafeguards: {
        championAAUnchanged: true,
        wageringUnchanged: true,
        canInfluenceProduction: false,
        canAuthorizeWager: false,
      },
      researchOnly: true,
      note: "Pass CFBD_API_KEY + champion baselines for a full frozen holdout run via GitHub Actions.",
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ status: report.status, blockers: report.blockers, outPath }, null, 2));
    process.exitCode = 3;
    return;
  }

  if (!archiveRows.length || !games.length) {
    if (!hasKey) {
      const coverage = auditCoreHoldoutCoverage({
        archiveRows,
        cfbdAccess: false,
        verifiedHistoricalCutoffs: false,
        championBaselinesAvailable: false,
        trainGameCount: 0,
        evalGameCount: 0,
      });
      const report = runCore2025Train2026HoldoutReport({
        games: [],
        archiveRows,
        cfbdAccess: false,
      });
      report.coverage = {
        teamCoverage: coverage.teamCoverage,
        trainCoverage: coverage.trainCoverage,
        evalCoverage: coverage.evalCoverage,
      };
      report.blockers = [
        {
          code: "cfbd_api_key_unavailable",
          detail:
            "CFBD_API_KEY missing locally; cannot reconstruct 2025 weekly CORE or fetch scored 2025/2026 games",
        },
        ...report.blockers.filter((b) => b.code !== "cfbd_api_key_unavailable"),
      ];
      report.executionNote =
        "Run via GitHub Actions job cfb-core-2025-2026-holdout (college.yml) with repository secret CFBD_API_KEY and optional CFB_HOLDOUT_BASELINES artifact.";
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
      console.log(
        JSON.stringify(
          {
            status: report.status,
            blocked: true,
            blockers: report.blockers,
            counts: report.counts,
            outPath,
          },
          null,
          2
        )
      );
      process.exitCode = 3;
      return;
    }

    for (const season of seasons) {
      const yearRows = await fetchCoreYear(env, season);
      const partitioned = partitionCoreRowsByThroughWeek(yearRows);
      const built = buildHistoricalCoreArchivePayloads({
        season,
        yearRows,
        authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
        collectionTime: new Date().toISOString(),
      });
      const seasonArchive = archiveRowsFromPayloads(built.payloads);
      archiveRows = archiveRows.concat(seasonArchive);
      const { games: seasonGames, errors } = await fetchSeasonGames(env, season);
      games = games.concat(seasonGames);
      reconstruct.seasons[season] = {
        distinctThroughWeeks: partitioned.distinctThroughWeekCount,
        throughWeeks: partitioned.throughWeeks,
        teamCountByWeek: Object.fromEntries(
          partitioned.throughWeeks.map((w) => [w, partitioned.buckets[w].rowCount])
        ),
        gamesFetched: seasonGames.length,
        gameFetchErrors: errors,
        authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
      };
    }
  }

  games = attachBaselines(games, baselines);
  const indexed = indexCoreArchivesBySeasonWeek(archiveRows);
  const report = runCore2025Train2026HoldoutReport({
    games,
    archiveRows,
    cfbdAccess: hasKey || Boolean(archiveRows.length && games.length),
  });
  report.reconstruction = reconstruct;
  report.archiveIndex = indexed.coverage;
  report.trainSeason = CORE_HOLDOUT_TRAIN_SEASON;
  report.evalSeason = CORE_HOLDOUT_EVAL_SEASON;

  // Persist weekly archive snapshot for audit (research artifact, not production).
  const archiveOut = resolve("artifacts/cfb-core-holdout-archives.json");
  mkdirSync(dirname(archiveOut), { recursive: true });
  writeFileSync(archiveOut, JSON.stringify(archiveRows, null, 2) + "\n");
  report.archiveArtifact = archiveOut;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        status: report.status,
        blocked: report.blocked,
        classification: report.classification,
        counts: report.counts,
        validationErrors: report.validationErrors,
        blockers: report.blockers,
        headToHeadVsChampionAA: report.headToHeadVsChampionAA,
        coefficientsFrozen: Boolean(report.coefficients?.frozen),
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
  console.error("CORE_HOLDOUT_FATAL:", err?.message || String(err));
  process.exit(2);
});

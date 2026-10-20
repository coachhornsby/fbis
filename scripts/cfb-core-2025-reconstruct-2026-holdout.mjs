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
 *   CFB_HOLDOUT_TIER3_DIR — optional dir of Tier3 CSVs to reconcile vs CORE
 *   CFB_HOLDOUT_BUILD_SP_BASELINES=1 — build CFB-FBIS-v2 baselines from CFBD SP when A/A file missing
 *   CFB_HOLDOUT_OUT       — report path (default artifacts/cfb-core-2025-2026-holdout-report.json)
 *
 * Research-only. Does not touch production A/A or wagering.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import { schoolKey } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
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
import {
  parseTier3TrainingCsv,
  reconcileTier3WithCoreArchives,
} from "../functions/lib/cfbCoreTier3Reconcile.js";

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
  if (!baselineRows?.length) return games.map((g) => ({ ...g, baselineSource: g.baselineSource || null }));
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
      byMatchup.get(`${g.season}:${g.week}:${schoolKey(g.homeTeam)}:${schoolKey(g.awayTeam)}`) ||
      byMatchup.get(`${g.season}::${schoolKey(g.homeTeam)}:${schoolKey(g.awayTeam)}`);
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
      rating: Number(row.rating ?? row.overall),
    };
  }
  return byTeam;
}

/** Build CFB-FBIS-v2 baselines from SP priors when frozen A/A snapshots are absent. */
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

function loadTier3Games(dir) {
  if (!dir || !existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.csv$/i.test(f));
  const games = [];
  for (const f of files) {
    const m = f.match(/(\d{4}).*week[_-]?(\d{1,2})/i);
    const season = m ? Number(m[1]) : null;
    const week = m ? Number(m[2]) : null;
    const parsed = parseTier3TrainingCsv(readFileSync(join(dir, f), "utf8"), {
      defaultSeason: season,
      defaultWeek: week,
    });
    for (const row of parsed.rows) {
      if (row.season == null && season != null) row.season = season;
      if (row.week == null && week != null) row.week = week;
      games.push(row);
    }
  }
  return games;
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

  // Prefer provided A/A; optionally build CFB-FBIS-v2 SP-prior baselines for gaps.
  const needBaselines = games.filter((g) => g.baselineHome == null || g.baselineAway == null);
  let baselineBuild = null;
  if (needBaselines.length && (process.env.CFB_HOLDOUT_BUILD_SP_BASELINES === "1" || !baselines.length)) {
    if (!hasKey) {
      baselineBuild = { ok: false, reason: "cfbd_required_for_sp_baselines", needed: needBaselines.length };
    } else {
      const spBySeason = {};
      for (const season of [...new Set(needBaselines.map((g) => g.season))]) {
        spBySeason[season] = await fetchSpIndex(env, season);
        await sleep(120);
      }
      baselineBuild = buildSpChampionBaselines(needBaselines, spBySeason);
      games = attachBaselines(games, baselineBuild.baselines);
    }
  }

  const aa2026 = games.filter(
    (g) =>
      g.season === CORE_HOLDOUT_EVAL_SEASON &&
      g.baselineHome != null &&
      g.baselineAway != null &&
      g.finalVerified
  );
  const preflight = {
    featureCoverage2025: indexCoreArchivesBySeasonWeek(archiveRows).coverage.find(
      (c) => c.season === CORE_HOLDOUT_TRAIN_SEASON
    ) || { season: 2025, distinctThroughWeeks: 0, throughWeeks: [] },
    aaBaselines2026: {
      n: aa2026.length,
      withChampionModel: aa2026.filter((g) => g.championModelId || /fbis|aa|provided|sp_prior/i.test(String(g.baselineSource || ""))).length,
      sources: [...new Set(aa2026.map((g) => g.baselineSource).filter(Boolean))],
      ok: aa2026.length >= 50,
    },
    baselineBuild,
  };

  const tier3Dir = process.env.CFB_HOLDOUT_TIER3_DIR || null;
  const tier3Games = loadTier3Games(tier3Dir);
  const tier3Reconcile = tier3Games.length
    ? reconcileTier3WithCoreArchives({ tier3Games, archiveRows })
    : { skipped: true, reason: tier3Dir ? "no_csv_parsed" : "CFB_HOLDOUT_TIER3_DIR_unset" };

  const indexed = indexCoreArchivesBySeasonWeek(archiveRows);

  // Gate: do not fit without 2025 CORE coverage + 2026 A/A baselines.
  const gateBlockers = [];
  if ((preflight.featureCoverage2025.distinctThroughWeeks || 0) < 3) {
    gateBlockers.push({
      code: "insufficient_2025_feature_coverage",
      have: preflight.featureCoverage2025,
      need: "≥3 distinct 2025 CORE throughWeek archives",
    });
  }
  if (!preflight.aaBaselines2026.ok) {
    gateBlockers.push({
      code: "insufficient_2026_aa_baselines",
      have: preflight.aaBaselines2026.n,
      need: "≥50 graded 2026 games with champion A/A (or FBIS-v2) pregame baselines",
    });
  }

  let report;
  if (gateBlockers.length) {
    report = runCore2025Train2026HoldoutReport({
      games: [],
      archiveRows,
      cfbdAccess: hasKey,
    });
    report.blockers = [...gateBlockers, ...report.blockers];
    report.status = "MODEL_C_BLOCKED";
    report.blocked = true;
    report.ok = false;
  } else {
    report = runCore2025Train2026HoldoutReport({
      games,
      archiveRows,
      cfbdAccess: hasKey || Boolean(archiveRows.length && games.length),
    });
  }

  report.reconstruction = reconstruct;
  report.archiveIndex = indexed.coverage;
  report.preflight = preflight;
  report.tier3Reconcile = tier3Reconcile;
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
        preflight: report.preflight,
        tier3Reconcile: {
          matched: report.tier3Reconcile?.matchedBothTeamsInCore,
          missingWeek: report.tier3Reconcile?.missingCoreThroughWeek,
          missingTeam: report.tier3Reconcile?.missingTeamInCore,
          skipped: report.tier3Reconcile?.skipped,
        },
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

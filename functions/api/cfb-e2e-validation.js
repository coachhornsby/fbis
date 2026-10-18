/**
 * CFB end-to-end validation API — acquisition through accuracy audits.
 * Read-only evaluation. Never mutates champion, wagers, or frozen snapshots.
 */

import {
  runFullE2eValidation,
  runAcquisitionAudit,
  runClassificationAudit,
  runConsumptionAudit,
  runFeatureImpactAudit,
  runAccuracyAudit,
  runGameCardVerification,
  runWeeklyRegressionSuite,
  E2E_VALIDATION_VERSION,
} from "../lib/cfbE2eValidation.js";
import { evaluateGameReadiness, summarizeReadinessSlate } from "../lib/cfbTuesdayReadiness.js";
import PRIOR_V1 from "../../data/cfb/prior-v1.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function currentCfbSeasonWeek(now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const season = m >= 8 ? y : y - 1;
  const start = Date.UTC(season, 7, 25);
  const cur = Date.UTC(y, m - 1, day);
  const week = Math.max(1, Math.min(20, Math.floor((cur - start) / (7 * 86400000)) + 1));
  return { season, week };
}

function priorForTeam(teamName, espnId) {
  if (espnId && PRIOR_V1?.byEspnId?.[String(espnId)]) {
    const r = PRIOR_V1.byEspnId[String(espnId)];
    return { priorOff: r.off, priorDef: r.def, school: r.school };
  }
  const school = String(teamName || "").toLowerCase();
  for (const [id, r] of Object.entries(PRIOR_V1?.byEspnId || {})) {
    if (String(r.school || "").toLowerCase() === school) {
      return { priorOff: r.off, priorDef: r.def, school: r.school, espnId: id };
    }
  }
  return {};
}

async function loadManifestEvidence(env, season, week) {
  const evidenceByDataset = {};
  if (!env?.DB) return { evidenceByDataset, d1FeatureTeamCount: null };
  try {
    const rows =
      (
        await env.DB.prepare(
          `SELECT dataset_id, status, http_ok, row_count, team_coverage, through_week,
                  schema_ok, content_hash, collected_at, evidence_json
             FROM cfb_collection_manifests
            WHERE season=? AND week=?
            ORDER BY collected_at DESC`
        )
          .bind(season, week)
          .all()
      ).results || [];
    for (const r of rows) {
      if (evidenceByDataset[r.dataset_id]) continue;
      evidenceByDataset[r.dataset_id] = {
        httpOk: Boolean(r.http_ok),
        rowCount: r.row_count,
        teamCoverage: r.team_coverage,
        throughWeek: r.through_week,
        schemaOk: r.schema_ok == null ? true : Boolean(r.schema_ok),
        contentHash: r.content_hash,
        collectedAt: r.collected_at,
        archived: Boolean(r.content_hash),
      };
    }
  } catch {
    /* pre-migration */
  }
  let d1FeatureTeamCount = null;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT team_id) AS n FROM team_feature_snapshots
        WHERE sport='cfb' AND season=? AND feature_version='cfb-features-v1'`
    )
      .bind(season)
      .first();
    d1FeatureTeamCount = Number(row?.n || 0);
  } catch {
    /* ignore */
  }
  return { evidenceByDataset, d1FeatureTeamCount };
}

async function loadLatestFeatures(env, season = 2026) {
  if (!env?.DB) return { byTeam: new Map(), bySchool: new Map(), n: 0 };
  try {
    const rows =
      (
        await env.DB.prepare(
          `SELECT team_id, features_json, as_of FROM team_feature_snapshots
            WHERE sport='cfb' AND season=? AND feature_version='cfb-features-v1'
            ORDER BY as_of DESC LIMIT 700`
        )
          .bind(season)
          .all()
      ).results || [];
    const byTeam = new Map();
    const bySchool = new Map();
    for (const r of rows) {
      if (byTeam.has(String(r.team_id))) continue;
      let f;
      try {
        f = JSON.parse(r.features_json || "{}");
      } catch {
        continue;
      }
      f.snapshotAsOf = r.as_of;
      byTeam.set(String(r.team_id), f);
      const school = String(f.team || f.school || "").toLowerCase();
      if (school && !bySchool.has(school)) bySchool.set(school, f);
    }
    return { byTeam, bySchool, n: byTeam.size };
  } catch {
    return { byTeam: new Map(), bySchool: new Map(), n: 0 };
  }
}

function matchFeatures(index, name, espnHint = null) {
  if (espnHint) {
    const hit =
      index.byTeam.get(`cfb-${espnHint}`) ||
      index.byTeam.get(`cfb:espn:${espnHint}`) ||
      index.byTeam.get(String(espnHint));
    if (hit) return hit;
  }
  const school = String(name || "").toLowerCase();
  return index.bySchool.get(school) || null;
}

async function loadTuesdayGames(env, dateIso = "2026-10-20") {
  if (!env?.DB) return [];
  try {
    let rows =
      (
        await env.DB.prepare(
          `SELECT id, home_name, away_name, start, date FROM games
            WHERE sport='cfb' AND (date = ? OR (start >= ? AND start < ?))
            ORDER BY start LIMIT 80`
        )
          .bind(
            dateIso,
            `${dateIso}T00:00:00`,
            `${dateIso.slice(0, 8)}${String(Number(dateIso.slice(8, 10)) + 1).padStart(2, "0")}T00:00:00`
          )
          .all()
      ).results || [];
    if (!rows.length) {
      rows =
        (
          await env.DB.prepare(
            `SELECT id, home_name, away_name, start, date FROM games
              WHERE sport='cfb' AND date IN (?, date(?, '+1 day'))
              ORDER BY start LIMIT 80`
          )
            .bind(dateIso, dateIso)
            .all()
        ).results || [];
    }
    return rows.map((r) => ({
      id: r.id,
      home: r.home_name,
      away: r.away_name,
      homeEspnId: null,
      awayEspnId: null,
      start: r.start,
      date: r.date,
    }));
  } catch {
    return [];
  }
}

async function persistValidationRun(env, report, season, week) {
  if (!env?.DB || !report) return null;
  const runId = `e2e-${season}-W${week}-${Date.now()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO cfb_e2e_validation_runs(
         run_id, season, week, triggered_by, overall_pass,
         five_essentials_json, acquisition_pass, classification_pass,
         consumption_pass, impact_pass, accuracy_pass, cards_pass, weekly_pass,
         unresolved_json, report_json, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        runId,
        season,
        week,
        "api",
        report.overallPass ? 1 : 0,
        JSON.stringify(report.fiveEssentials || {}),
        report.tests?.[1]?.pass ? 1 : 0,
        report.tests?.[2]?.pass ? 1 : 0,
        report.tests?.[3]?.pass ? 1 : 0,
        report.tests?.[4]?.pass ? 1 : 0,
        report.tests?.[5]?.pass ? 1 : 0,
        report.tests?.[6]?.pass ? 1 : 0,
        report.tests?.[7]?.pass ? 1 : 0,
        JSON.stringify(report.unresolvedFindings || []),
        JSON.stringify({
          version: report.version,
          overallPass: report.overallPass,
          fiveEssentials: report.fiveEssentials,
          unresolvedCount: (report.unresolvedFindings || []).length,
        }),
        new Date().toISOString()
      )
      .run();
    return runId;
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const section = String(url.searchParams.get("section") || "full").toLowerCase();
  const date = String(url.searchParams.get("date") || "2026-10-20");
  const persist = url.searchParams.get("persist") === "1";
  const { season, week } = currentCfbSeasonWeek();
  const env = context.env;

  const { evidenceByDataset, d1FeatureTeamCount } = await loadManifestEvidence(env, season, week);
  const featIndex = await loadLatestFeatures(env, season);
  const games = await loadTuesdayGames(env, date);
  const readinessResults = [];
  for (const game of games) {
    const homeFeatures = matchFeatures(featIndex, game.home, game.homeEspnId) || {};
    const awayFeatures = matchFeatures(featIndex, game.away, game.awayEspnId) || {};
    const homePrior = priorForTeam(game.home, game.homeEspnId);
    const awayPrior = priorForTeam(game.away, game.awayEspnId);
    readinessResults.push(
      evaluateGameReadiness({ game, homeFeatures, awayFeatures, homePrior, awayPrior })
    );
  }

  const baseOpts = {
    season,
    week,
    evidenceByDataset,
    d1FeatureTeamCount: d1FeatureTeamCount ?? featIndex.n,
    readinessResults,
  };

  if (section === "acquisition") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runAcquisitionAudit(baseOpts) });
  }
  if (section === "classification") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runClassificationAudit(baseOpts) });
  }
  if (section === "consumption") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runConsumptionAudit(baseOpts) });
  }
  if (section === "impact") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runFeatureImpactAudit(baseOpts) });
  }
  if (section === "accuracy") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runAccuracyAudit(baseOpts) });
  }
  if (section === "cards" || section === "tuesday") {
    return json({
      ok: true,
      version: E2E_VALIDATION_VERSION,
      ...runGameCardVerification(baseOpts),
      slate: summarizeReadinessSlate(readinessResults),
    });
  }
  if (section === "weekly") {
    return json({ ok: true, version: E2E_VALIDATION_VERSION, ...runWeeklyRegressionSuite(baseOpts) });
  }

  const report = runFullE2eValidation(baseOpts);
  let runId = null;
  if (persist) runId = await persistValidationRun(env, report, season, week);

  return json({
    ok: true,
    version: E2E_VALIDATION_VERSION,
    season,
    week,
    date,
    featureSnapshotTeams: featIndex.n,
    tuesdayGames: games.length,
    persistedRunId: runId,
    report,
  });
}

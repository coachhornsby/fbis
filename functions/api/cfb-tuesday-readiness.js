/**
 * CFB slate readiness gate API — Ready / Provisional / Blocked per matchup.
 * Read-only evaluation + optional discovery of upcoming games from D1.
 */

import {
  evaluateGameReadiness,
  summarizeReadinessSlate,
  READINESS_VERSION,
} from "../lib/cfbTuesdayReadiness.js";
import { reconcileCollectionHealth } from "../lib/cfbCollectionAlerts.js";
import { buildFeatureContractReport } from "../lib/cfbFeatureContract.js";
import PRIOR_V1 from "../../data/cfb/prior-v1.js";
import { buildSourceToModelAudit } from "../lib/cfbSourceToModelAudit.js";
import { summarizeTier3Entitlements } from "../lib/cfbTier3Entitlements.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
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

async function loadLatestFeatures(env, season = 2026) {
  if (!env?.DB) return new Map();
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
      f.canonicalId = f.canonicalId || r.team_id;
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
  const key = String(name || "").toLowerCase();
  return index.bySchool.get(key) || null;
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date") || "2026-10-20";
  const season = Number(url.searchParams.get("season") || 2026);
  const week = Number(url.searchParams.get("week") || 9);

  const index = await loadLatestFeatures(env, season);
  let games = [];
  if (env?.DB) {
    try {
      games =
        (
          await env.DB.prepare(
            `SELECT id, home_name, away_name, start, date FROM games
              WHERE sport='cfb' AND (date = ? OR (start >= ? AND start < ?))
              ORDER BY start LIMIT 80`
          )
            .bind(date, `${date}T00:00:00`, `${date.slice(0, 8)}${String(Number(date.slice(8, 10)) + 1).padStart(2, "0")}T00:00:00`)
            .all()
        ).results || [];
    } catch {
      games = [];
    }
    // Also accept next calendar day window for late CT kickoffs labeled next date
    if (!games.length) {
      try {
        games =
          (
            await env.DB.prepare(
              `SELECT id, home_name, away_name, start, date FROM games
                WHERE sport='cfb' AND date IN (?, date(?, '+1 day'))
                ORDER BY start LIMIT 80`
            )
              .bind(date, date)
              .all()
          ).results || [];
      } catch {
        games = [];
      }
    }
  }

  const results = [];
  for (const g of games) {
    const homeFeatures = matchFeatures(index, g.home_name) || {};
    const awayFeatures = matchFeatures(index, g.away_name) || {};
    const homePrior = priorForTeam(g.home_name, homeFeatures.espnId);
    const awayPrior = priorForTeam(g.away_name, awayFeatures.espnId);
    const readiness = evaluateGameReadiness({
      game: { ...g, season, week },
      homeFeatures: { ...homeFeatures, priorOff: homePrior.priorOff, priorDef: homePrior.priorDef },
      awayFeatures: { ...awayFeatures, priorOff: awayPrior.priorOff, priorDef: awayPrior.priorDef },
      homePrior,
      awayPrior,
    });
    readiness.sourceToModelAudit = buildSourceToModelAudit({
      game: { ...g, season, week, homeEspnId: homeFeatures.espnId, awayEspnId: awayFeatures.espnId },
      homeFeatures: { ...homeFeatures, priorOff: homePrior.priorOff, priorDef: homePrior.priorDef },
      awayFeatures: { ...awayFeatures, priorOff: awayPrior.priorOff, priorDef: awayPrior.priorDef },
      projection: readiness.projection,
      challengerIds: ["A", "B", "C", "D"],
      coreResearchEligible: true,
      archived: true,
    });
    results.push(readiness);
  }

  const summary = summarizeReadinessSlate(results);
  const collection = reconcileCollectionHealth({
    season,
    week,
    d1FeatureTeamCount: index.n,
    evidenceByDataset: {},
  });

  // Model-input integrity summary from feature index
  let withPpa = 0;
  let withGp = 0;
  let withBoth = 0;
  let fallbackGp = 0;
  for (const f of index.byTeam.values()) {
    const ppa = f.ppaOff != null || f.offensePpa != null;
    const gp = Number(f.gamesPlayed) > 0 || (f.coreWeekBounded && Number(f.coreThroughWeek) > 0);
    if (ppa) withPpa += 1;
    if (gp) withGp += 1;
    if (ppa && gp) withBoth += 1;
    if (f.gamesPlayedSource === "coreThroughWeekFallback" || (!f.gamesPlayed && f.coreWeekBounded)) {
      fallbackGp += 1;
    }
  }

  return json({
    ok: true,
    version: READINESS_VERSION,
    date,
    season,
    week,
    gamesDiscovered: games.length,
    scheduleGap: games.length === 0,
    scheduleGapNote:
      games.length === 0
        ? "No CFB games in D1 for this date — run schedule ingest before board launch"
        : null,
    summary,
    games: results,
    modelInputIntegrity: {
      featureTeams: index.n,
      withPpa,
      withGamesPlayedOrFallback: withGp,
      withBoth,
      coreThroughWeekFallbackRows: fallbackGp,
      pctPpa: index.n ? Math.round((withPpa / index.n) * 1000) / 10 : 0,
    },
    collectionHealth: {
      healthy: collection.healthy,
      criticalCount: collection.criticalCount,
      alerts: collection.alerts.slice(0, 20),
    },
    featureContract: buildFeatureContractReport(),
    tier3Summary: summarizeTier3Entitlements(),
    disposition: summary.disposition,
  });
}

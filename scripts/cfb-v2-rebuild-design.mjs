#!/usr/bin/env node
/**
 * Rebuild CFB-FBIS-v2 design rows with live prior provenance after talent-catalog repair.
 * Env: CFBD_API_KEY; CFB_FINAL_SEASONS=2022,2023,2024,2025
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import {
  fetchSeasonFeatureBundle,
  buildPriorCatalog,
  buildFcsConferenceStrength,
  assembleGameFeatures,
  schoolKey,
} from "../functions/lib/cfbFeaturePipeline.js";
import { indexCoreByTeam } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";
import {
  auditPreseasonPriorSources,
  buildModelInputProvenance,
} from "../functions/lib/cfbTemporalAudit.js";

const DESIGN_PATH = "artifacts/cfb-fbis-v2-design-rows.jsonl";
const DESIGN_PREV = "artifacts/cfb-fbis-v2-design-rows-pre-talent-5306.jsonl";
const SNAPSHOT_PATH = "artifacts/cfb-fbis-v2-snapshot-summaries.json";
const CACHE_DIR = "artifacts/cfbd-http-cache";

const seasons = (process.env.CFB_FINAL_SEASONS || "2022,2023,2024,2025")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Number.isFinite);
const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };

mkdirSync("artifacts", { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync("data/cfbd/calibration", { recursive: true });

function sha256(x) {
  return createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
}
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sideSum(a, b) {
  const x = num(a);
  const y = num(b);
  if (x == null && y == null) return null;
  return (x || 0) + (y || 0);
}

async function diskCachedFetch(url, init = {}) {
  const key = sha256({ url: String(url), method: init.method || "GET" });
  const fp = `${CACHE_DIR}/http-${key}.json`;
  if (existsSync(fp)) {
    const cached = JSON.parse(readFileSync(fp, "utf8"));
    return new Response(JSON.stringify(cached.body), {
      status: cached.status || 200,
      headers: { "content-type": "application/json" },
    });
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  writeFileSync(fp, JSON.stringify({ status: res.status, body }));
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

async function fetchWeeks(path, season) {
  const rows = [];
  let calls = 0, errors = 0;
  for (let week = 1; week <= 15; week++) {
    const res = await cfbdGet(path, env, {
      query: { year: season, week, seasonType: "regular" },
      fetchFn: diskCachedFetch,
    });
    calls += 1;
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) rows.push({ ...r, week, startDate: r.startDate || r.start_date || null });
    } else if (!res.ok) errors += 1;
  }
  return { rows, calls, errors };
}

function attachKickoffs(rows, games) {
  const byId = new Map((games || []).map((g) => [String(g.id), g.startDate || g.start_date]));
  return (rows || []).map((r) => ({
    ...r,
    startDate: r.startDate || byId.get(String(r.gameId || r.game_id || r.id)) || null,
    gameId: r.gameId || r.game_id || r.id || null,
  }));
}

function pickClosingLine(row) {
  let best = null;
  for (const L of row.lines || []) {
    if (L.spread != null || L.overUnder != null) best = L;
    if (String(L.provider || "").toLowerCase().includes("consensus")) best = L;
  }
  return best;
}

function toDesignRow(game, record) {
  const home = record.features?.home || {};
  const away = record.features?.away || {};
  const gameInput = {
    home: { name: record.home_team },
    away: { name: record.away_team },
    neutralSite: Boolean(record.features?.neutralSite),
    featureCutoffOk: true,
    cfbFbisV2Input: {
      home: { ...home, qbPpa: home.qbHistoricalUnsafe ? null : home.qbPpa },
      away: { ...away, qbPpa: away.qbHistoricalUnsafe ? null : away.qbPpa },
      neutralSite: record.features?.neutralSite,
    },
  };
  const proj = projectCfbFbisV2(gameInput, { ablation: "K" });
  if (!proj?.ok) return null;
  const d = proj.decomposition || {};
  const actualHome = num(game.homePoints ?? game.home_points);
  const actualAway = num(game.awayPoints ?? game.away_points);
  if (actualHome == null || actualAway == null) return null;
  const qbVal = num(d.QB);
  const paceVal = num(d.PACE);
  return {
    gameId: String(game.id),
    season: Number(game.season || record.season),
    week: Number(game.week || record.week),
    homeTeam: record.home_team,
    awayTeam: record.away_team,
    neutralSite: Boolean(record.features?.neutralSite),
    actualHome,
    actualAway,
    actualMargin: actualHome - actualAway,
    actualTotal: actualHome + actualAway,
    closingSpread: num(record.features?.evaluation?.closingSpread),
    closingTotal: num(record.features?.evaluation?.closingTotal),
    marginFeatures: {
      base: num(d.BASE_POWER),
      pass: num(d.PASS_MATCHUP),
      rush: num(d.RUSH_MATCHUP),
      success: num(d.SUCCESS),
      explosiveness: num(d.EXPLOSIVENESS),
      havoc: num(d.HAVOC),
      trenches: num(d.TRENCHES),
      finishing: num(d.FINISHING_DRIVES),
      qb: qbVal,
      pace: paceVal,
      context: (num(d.HFA) || 0) + (num(d.WEATHER_CONTEXT) || 0),
    },
    totalFeatures: {
      base_total: sideSum(home.off ?? home.priorOff, away.off ?? away.priorOff),
      pass_total: sideSum(home.passEpa, away.passEpa),
      rush_total: sideSum(home.rushEpa, away.rushEpa),
      success_total: sideSum(home.successRate, away.successRate),
      explosiveness_total: sideSum(home.explosiveRate ?? home.explosiveness, away.explosiveRate ?? away.explosiveness),
      havoc_total: sideSum(home.havocRate, away.havocRate),
      trenches_total: sideSum(home.lineYards, away.lineYards),
      finishing_total: sideSum(home.pointsPerOpportunity, away.pointsPerOpportunity),
      qb_total: sideSum(home.qbPpa, away.qbPpa),
      pace_total: sideSum(home.paceNorm, away.paceNorm),
      context_total: num(d.WEATHER_CONTEXT),
    },
    present: {
      base: d.BASE_POWER != null,
      pass: d.PASS_MATCHUP != null,
      rush: d.RUSH_MATCHUP != null,
      success: d.SUCCESS != null,
      explosiveness: d.EXPLOSIVENESS != null,
      havoc: d.HAVOC != null,
      trenches: d.TRENCHES != null,
      finishing: d.FINISHING_DRIVES != null,
      qb: qbVal != null && Math.abs(qbVal) > 1e-9,
      pace: paceVal != null && Math.abs(paceVal) > 1e-9,
      context: true,
    },
    provisionalMargin: num(proj.margin),
    provisionalTotal: num(proj.total),
    catalogMembership: {
      home: home.catalogMembership || null,
      away: away.catalogMembership || null,
    },
  };
}

async function main() {
  if (!env.CFBD_API_KEY) throw new Error("CFBD_API_KEY required");
  if (existsSync(DESIGN_PATH) && !existsSync(DESIGN_PREV)) {
    copyFileSync(DESIGN_PATH, DESIGN_PREV);
    console.error(JSON.stringify({ phase: "preserved-prev-design", path: DESIGN_PREV }));
  }
  const prevN = existsSync(DESIGN_PREV)
    ? readFileSync(DESIGN_PREV, "utf8").split("\n").filter(Boolean).length
    : null;

  const rows = [];
  const snapshots = [];
  const rejectCounts = {};
  const bump = (k) => { rejectCounts[k] = (rejectCounts[k] || 0) + 1; };

  for (const season of seasons) {
    const priorSeason = season - 1;
    console.error(JSON.stringify({ phase: "season-start", season, priorSeason }));

    const priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, { week: null, fetchFn: diskCachedFetch });
    const priorCatalog = buildPriorCatalog(priorBundle);
    console.error(JSON.stringify({
      phase: "prior-catalog", priorSeason, n: priorCatalog.n,
      talentKeysAdded: priorCatalog.talentKeysAdded, talentOnlyKeys: priorCatalog.talentOnlyKeys,
    }));
    const confMap = buildFcsConferenceStrength(priorCatalog);
    const seasonBundle = await fetchSeasonFeatureBundle(env, season, { week: null, fetchFn: diskCachedFetch });
    const games = (seasonBundle.endpoints?.games?.data || []).filter(
      (g) => (g.homePoints ?? g.home_points) != null && (g.awayPoints ?? g.away_points) != null
    );

    const ppa = await fetchWeeks("/ppa/games", season);
    const adv = await fetchWeeks("/stats/game/advanced", season);
    const lines = await fetchWeeks("/lines", season);
    const ppaRows = attachKickoffs(ppa.rows, games);
    const advRows = attachKickoffs(adv.rows, games);

    const linesByGame = new Map();
    for (const row of lines.rows || []) {
      const id = String(row.id || row.gameId || "");
      if (!id) continue;
      const best = pickClosingLine(row);
      if (best) linesByGame.set(id, { spread: best.spread ?? null, total: best.overUnder ?? null });
    }

    let provenancePass = 0;
    let designN = 0;
    for (const g of games) {
      const kickoff = g.startDate || g.start_date;
      if (!kickoff) { bump("missing-kickoff"); continue; }
      const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
      const maxCoreWeek = Math.max(0, Number(g.week) - 1);
      const coreByTeam = indexCoreByTeam([], { maxWeek: maxCoreWeek, seasonType: "regular" });

      const homeKey = schoolKey(g.homeTeam || g.home_team);
      const awayKey = schoolKey(g.awayTeam || g.away_team);
      const homeEntry = priorCatalog.bySchool[homeKey] || null;
      const awayEntry = priorCatalog.bySchool[awayKey] || null;
      const homePriorAudit = auditPreseasonPriorSources({ gameYear: season, priorCatalogEntry: homeEntry, priorSeason });
      const awayPriorAudit = auditPreseasonPriorSources({ gameYear: season, priorCatalogEntry: awayEntry, priorSeason });
      if (!homePriorAudit.ok || !awayPriorAudit.ok) {
        const reason = (!homePriorAudit.ok && homePriorAudit.exclusionReason) || (!awayPriorAudit.ok && awayPriorAudit.exclusionReason) || "prior-fail";
        bump(`prior:${reason}`);
        snapshots.push({
          game_id: String(g.id), season, week: g.week,
          home_team: g.homeTeam || g.home_team, away_team: g.awayTeam || g.away_team,
          provenancePass: false, priorOk: { home: homePriorAudit.ok, away: awayPriorAudit.ok }, reject: reason,
        });
        continue;
      }

      const record = assembleGameFeatures({
        game: g, priorCatalog, confMap,
        ppaGameRows: ppaRows, advGameRows: advRows,
        qbRows: [], usageRows: [], playerGameRows: [],
        coreByTeam, collectionTimestamp: asOf, mode: "historical",
      });
      if (!record?.temporalOk) { bump("temporal-gate-fail"); continue; }

      const line = linesByGame.get(String(g.id));
      if (line) {
        record.features.evaluation = {
          ...(record.features.evaluation || {}),
          closingSpread: line.spread,
          closingTotal: line.total,
        };
      }

      const provenance = buildModelInputProvenance({
        game: g, featureRecord: record, roles: null, mode: "historical",
        priorAudits: { home: homePriorAudit, away: awayPriorAudit },
      });
      const pass = provenance.provenancePass === true;
      if (pass) provenancePass += 1; else bump("provenance-fail");

      snapshots.push({
        game_id: String(g.id), season, week: g.week, kickoff_timestamp: kickoff,
        home_team: record.home_team, away_team: record.away_team,
        provenancePass: pass, priorOk: { home: true, away: true },
        catalogMembership: {
          home: homeEntry?.catalogMembership || null,
          away: awayEntry?.catalogMembership || null,
        },
      });
      if (!pass) continue;

      const row = toDesignRow(g, record);
      if (!row) { bump("not-projectable"); continue; }
      rows.push(row);
      designN += 1;
    }

    console.error(JSON.stringify({
      phase: "season-done", season, games: games.length, provenancePass, designRows: designN,
      total: rows.length, catalogN: priorCatalog.n, talentOnlyKeys: priorCatalog.talentOnlyKeys,
    }));
  }

  writeFileSync(DESIGN_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshots, null, 2));

  const bySeason = {};
  for (const r of rows) bySeason[r.season] = (bySeason[r.season] || 0) + 1;
  const prevBySeason = {};
  if (existsSync(DESIGN_PREV)) {
    for (const line of readFileSync(DESIGN_PREV, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      prevBySeason[r.season] = (prevBySeason[r.season] || 0) + 1;
    }
  }

  const coverage = {
    generatedAt: new Date().toISOString(),
    oldEligibleN: prevN,
    newEligibleN: rows.length,
    oldBySeason: prevBySeason,
    newBySeason: bySeason,
    rejectCounts,
    designSha256: sha256(readFileSync(DESIGN_PATH)),
    snapshotSha256: sha256(readFileSync(SNAPSHOT_PATH)),
  };
  writeFileSync("artifacts/cfb-v2-coverage-repair.json", JSON.stringify(coverage, null, 2));
  writeFileSync("data/cfbd/calibration/coverage-repair.json", JSON.stringify(coverage, null, 2));
  console.log(JSON.stringify({ ok: true, ...coverage }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

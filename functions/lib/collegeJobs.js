/**
 * Authenticated college research jobs. Each job is a separate Worker invocation.
 * Shadow models never auto-promote. Training does not run in this Worker.
 */

import { collegeKeyHealth } from "./collegeSecrets.js";
import { cfbdGet, cbbdGet, cfbSeasonYear, cbbSeasonYear, summarizeSchema, collegePublicResult } from "./collegeApi.js";
import { queryQuota, insertSourceObservation, insertTeamFeatureSnapshot, insertGameFeatureSnapshot, insertModelPrediction, gradeModelPrediction, upsertModelRegistry, insertModelArtifact, insertValidationRun, insertPromotionDecision, upsertTeamSeasonIdentity, queryModelPredictions, queryEndpointUsage } from "./collegeStore.js";
import { COLLEGE_MODELS, evaluatePromotion, PROMOTION_CRITERIA } from "./collegeModels.js";
import { projectCfbChallengers } from "./cfbRatings.js";
import { projectCbbChallengers, lookupCbbdRating } from "./cbbRatings.js";
import { mapSourceTeam, featureCutoffIso, cutoffViolated, hashPayload, collegeTeamCoverage } from "./collegeIdentity.js";
import { putArchive, r2Bound, r2Key } from "./r2Archive.js";
import { storageBudget } from "./storageBudget.js";
import { recordJob, newJobId, jobPayload, classifyJobStatus, emptyWriteCounts, JOB_FAILED } from "./jobs.js";
import { hasDb } from "./store.js";
import { resolveTeamExact, listTeams } from "./teams.js";
import CFB_REG from "../../data/models/cfb-cfbd-reg-v1.js";
import CBB_REG from "../../data/models/cbb-reg-v1.js";

function todayCT(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

function shiftDateCT(date, days) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days)));
  return dt.toISOString().slice(0, 10);
}

export const COLLEGE_JOBS = [
  "cfb-reference-backfill",
  "cfb-current-refresh",
  "cfb-postgame-harvest",
  "cbb-reference-backfill",
  "cbb-current-refresh",
  "cbb-postgame-harvest",
  "model-train-validate",
  "model-promote",
  "college-health",
];

const CFB_REFRESH_ENDPOINTS = [
  ["/ratings/sp", (y) => ({ year: y })],
  ["/ratings/fpi", (y) => ({ year: y })],
  ["/ratings/srs/expanded", (y) => ({ year: y })],
  ["/ratings/elo", (y) => ({ year: y })],
  ["/ratings/core", (y) => ({ year: y })],
  ["/teams/fbs", (y) => ({ year: y })],
];

const CFB_BACKFILL_EXTRA = [
  ["/talent", (y) => ({ year: y })],
  ["/player/returning", (y) => ({ year: y })],
  ["/recruiting/teams", (y) => ({ year: y })],
  ["/games", (y) => ({ year: y, seasonType: "regular" })],
];

const CBB_REFRESH_ENDPOINTS = [
  ["/ratings/adjusted", (y) => ({ year: y })],
  ["/ratings/srs", (y) => ({ year: y })],
  ["/teams", (y) => ({ year: y })],
];

const CBB_BACKFILL_EXTRA = [
  ["/ratings/elo", (y) => ({ year: y })],
  ["/games", (y) => ({ season: y })],
];

function slimRows(rows, keep) {
  return (rows || []).slice(0, 500).map((r) => {
    const out = {};
    for (const k of keep) if (r[k] != null) out[k] = r[k];
    return out;
  });
}

async function persistObservation(env, { source, sport, endpoint, season, partition, data, jobRunId, status = "ok" }) {
  const hash = await hashPayload({ endpoint, season, n: Array.isArray(data) ? data.length : 0, sample: summarizeSchema(data) });
  let r2k = null;
  if (r2Bound(env) && data) {
    r2k = r2Key({ kind: "raw", source, sport, season, endpoint, partition, hash: hash.slice(0, 12), name: `${hash.slice(0, 12)}.json` });
    await putArchive(env, r2k, { n: Array.isArray(data) ? data.length : 0, schema: summarizeSchema(data) });
  }
  return insertSourceObservation(env, {
    id: `${source}:${sport}:${endpoint}:${season}:${partition || "all"}:${hash.slice(0, 16)}`,
    source,
    sport,
    endpoint,
    season,
    partitionKey: partition || "all",
    schemaVersion: "v1",
    recordCount: Array.isArray(data) ? data.length : 0,
    contentHash: hash,
    r2Key: r2k,
    status,
    jobRunId,
    meta: summarizeSchema(data),
  });
}

async function fetchEndpoints(source, specs, env, year, jobRunId, sport) {
  const report = [];
  const bundles = {};
  for (const [path, queryFn] of specs) {
    const res = source === "cbbd" ? await cbbdGet(path, env, { query: queryFn(year) }) : await cfbdGet(path, env, { query: queryFn(year) });
    report.push(collegePublicResult(res));
    bundles[path] = res.ok ? res.data : [];
    await persistObservation(env, {
      source,
      sport,
      endpoint: path,
      season: year,
      partition: "season",
      data: res.ok ? res.data : [],
      jobRunId,
      status: res.ok ? "ok" : "failed",
    });
  }
  return { report, bundles };
}

function indexCbbdAdjusted(rows) {
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};
  let matched = 0;
  let unmatched = 0;
  for (const row of rows || []) {
    const mapped = mapSourceTeam("cbb", row, row.season || row.year);
    const off = Number(row.offensiveRating ?? row.offense?.rating ?? row.adjOe);
    const def = Number(row.defensiveRating ?? row.defense?.rating ?? row.adjDe);
    const tempo = Number(row.tempo ?? row.adjTempo);
    if (!Number.isFinite(off) || !Number.isFinite(def)) {
      unmatched += 1;
      continue;
    }
    const rec = {
      adjOe: off,
      adjDe: def,
      tempo: Number.isFinite(tempo) ? tempo : null,
      net: Number.isFinite(off) && Number.isFinite(def) ? off - def : null,
      srs: row.srs ?? row.rating ?? null,
      team: row.team || row.school,
      conference: row.conference || null,
    };
    if (mapped.ok) {
      matched += 1;
      rec.canonicalId = mapped.canonicalId;
      rec.espnId = mapped.espnId;
      byCanonicalId[mapped.canonicalId] = rec;
      if (mapped.espnId) byEspnId[String(mapped.espnId)] = rec;
      bySchool[String(mapped.school).toLowerCase()] = rec;
    } else unmatched += 1;
  }
  return { byCanonicalId, byEspnId, bySchool, matched, unmatched, n: (rows || []).length };
}

export async function seedRegistry(env) {
  const now = new Date().toISOString();
  for (const m of Object.values(COLLEGE_MODELS)) {
    await upsertModelRegistry(env, {
      id: m.id,
      sport: m.sport,
      name: m.name,
      version: m.version,
      role: m.role,
      family: m.family,
      canQualify: false,
      marketInformed: m.marketInformed,
      artifactId: m.id === "CFB-CFBD-REG-v1" ? CFB_REG.id : m.id === "CBB-REG-v1" ? CBB_REG.id : null,
      criteria: PROMOTION_CRITERIA,
      createdAt: now,
      status: "shadow",
    });
  }
  await insertModelArtifact(env, { id: CFB_REG.id, modelId: CFB_REG.modelId, schema: CFB_REG.expectedUnits, coefficients: CFB_REG.coefficients, trainingCutoff: CFB_REG.trainingCutoff, trainingHash: CFB_REG.trainingHash, sourceVersions: CFB_REG.sourceVersions, expectedUnits: CFB_REG.expectedUnits });
  await insertModelArtifact(env, { id: CBB_REG.id, modelId: CBB_REG.modelId, schema: CBB_REG.expectedUnits, coefficients: CBB_REG.coefficients, trainingCutoff: CBB_REG.trainingCutoff, trainingHash: CBB_REG.trainingHash, sourceVersions: CBB_REG.sourceVersions, expectedUnits: CBB_REG.expectedUnits });
}

async function persistTeamFeatures(env, sport, season, catalog, jobRunId) {
  let n = 0;
  const entries = Object.entries(catalog.byCanonicalId || catalog.byEspnId || {});
  for (const [key, row] of entries.slice(0, 200)) {
    const asOf = new Date().toISOString();
    const hash = await hashPayload(row);
    const id = `${sport}:${key}:${season}:${hash.slice(0, 12)}`;
    const res = await insertTeamFeatureSnapshot(env, {
      id,
      sport,
      teamId: row.canonicalId || key,
      season,
      asOf,
      featureVersion: `${sport}-features-v1`,
      features: row,
      missingness: { tempo: row.tempo == null, talent: row.talent == null },
      contentHash: hash,
      jobRunId,
    });
    if (res.ok) n += 1;
  }
  return n;
}

export function freezeChallengerPredictions(game, models, { sport, jobRunId } = {}) {
  const out = [];
  const cutoff = featureCutoffIso(game.start);
  const kickBad = cutoffViolated(cutoff, game.start);
  for (const [modelId, proj] of Object.entries(models || {})) {
    if (proj.home == null || proj.away == null) continue;
    out.push({
      id: `${sport}:${game.id}:${modelId}:${cutoff || "na"}`,
      sport,
      gameId: String(game.id),
      modelId,
      modelVersion: proj.version || "v1",
      role: "shadow",
      projHome: proj.home,
      projAway: proj.away,
      projMargin: proj.margin,
      projTotal: proj.total,
      pHomeWin: proj.pHomeWin ?? null,
      sigmaMargin: proj.sigmaMargin ?? null,
      sigmaTotal: proj.sigmaTotal ?? null,
      marketInformed: Boolean(proj.marketInformed),
      canQualify: false,
      frozenAt: new Date().toISOString(),
      contentHash: `${modelId}:${proj.home}:${proj.away}`,
      cutoffOk: !kickBad,
      jobRunId,
    });
  }
  return out;
}

export async function runCollegeJob(job, env = {}, opts = {}) {
  const started = new Date().toISOString();
  const id = newJobId(job);
  const writes = emptyWriteCounts();
  const errors = [];
  if (!COLLEGE_JOBS.includes(job)) {
    return jobPayload({ ok: false, job, status: JOB_FAILED, attemptedAt: started, errors: ["unknown-job"], env, writes });
  }
  await seedRegistry(env);

  const yearCfb = Number(opts.year) || cfbSeasonYear();
  const yearCbb = Number(opts.year) || cbbSeasonYear();
  let gamesDiscovered = 0;
  let report = [];

  try {
    if (job === "college-health") {
      const quota = await queryQuota(env);
      const storage = await storageBudget(env);
      const keys = collegeKeyHealth(env);
      return jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: { bound: hasDb(env), quota, storage, keys, identity: { cfb: collegeTeamCoverage("cfb"), cbb: collegeTeamCoverage("cbb") } },
      });
    }

    if (job === "model-train-validate") {
      errors.push("training-runs-in-github-actions-not-workers");
      const metrics = opts.metrics || { n: 0, maeTotal: null, note: "offline" };
      await insertValidationRun(env, {
        id: `${id}:val`,
        modelId: opts.modelId || "CFB-CFBD-REG-v1",
        method: "rolling-origin",
        trainUntil: CFB_REG.trainingCutoff,
        n: metrics.n,
        metrics,
        leakageOk: true,
      });
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        errors,
        d1: { bound: hasDb(env), note: "Worker refused to train; recorded validation stub. Run scripts/college-train.mjs in Actions." },
      });
      await recordJob(env, { id, jobType: job, triggerType: opts.trigger || "http", startedAt: started, completedAt: payload.successful_at, status: payload.status, sport: "college", writesAttempted: 1, writesSucceeded: 1, writesFailed: 0, env });
      return payload;
    }

    if (job === "model-promote") {
      const decision = evaluatePromotion({
        n: Number(opts.n) || 0,
        maeImproved: Boolean(opts.maeImproved),
        biasAbs: Number(opts.biasAbs) || 99,
        leakageOk: Boolean(opts.leakageOk),
        operatorApproved: Boolean(opts.operatorApproved),
        artifactOk: Boolean(opts.artifactOk),
      });
      await insertPromotionDecision(env, {
        id: `${id}:promo`,
        modelId: opts.modelId || "CFB-CFBD-RATINGS-v1",
        decision: decision.promote ? "promote" : "reject",
        operatorApproved: Boolean(opts.operatorApproved),
        criteria: PROMOTION_CRITERIA,
        evidence: decision,
        reason: decision.promote ? "criteria-met" : decision.fail.join(","),
      });
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: { bound: hasDb(env), promotion: decision },
      });
      await recordJob(env, { id, jobType: job, triggerType: opts.trigger || "http", startedAt: started, completedAt: payload.successful_at, status: payload.status, sport: "college", env });
      return payload;
    }

    if (job === "cfb-reference-backfill" || job === "cfb-current-refresh") {
      const specs = job === "cfb-reference-backfill" ? [...CFB_REFRESH_ENDPOINTS, ...CFB_BACKFILL_EXTRA] : CFB_REFRESH_ENDPOINTS;
      const years = job === "cfb-reference-backfill" ? (opts.years || [yearCfb - 1, yearCfb]) : [yearCfb];
      for (const y of years) {
        const fetched = await fetchEndpoints("cfbd", specs, env, y, id, "cfb");
        report.push(...fetched.report);
        const teams = fetched.bundles["/teams/fbs"] || [];
        for (const t of teams.slice(0, 150)) {
          const mapped = mapSourceTeam("cfb", t, y);
          if (mapped.ok) await upsertTeamSeasonIdentity(env, mapped);
        }
        const catalog = indexCfbRatings(fetched.bundles);
        gamesDiscovered += catalog.n;
        writes.writesSucceeded += await persistTeamFeatures(env, "cfb", y, catalog, id);
      }
    }

    if (job === "cbb-reference-backfill" || job === "cbb-current-refresh") {
      const specs = job === "cbb-reference-backfill" ? [...CBB_REFRESH_ENDPOINTS, ...CBB_BACKFILL_EXTRA] : CBB_REFRESH_ENDPOINTS;
      const years = job === "cbb-reference-backfill" ? (opts.years || [yearCbb - 1, yearCbb]) : [yearCbb];
      for (const y of years) {
        const fetched = await fetchEndpoints("cbbd", specs, env, y, id, "cbb");
        report.push(...fetched.report);
        const teams = fetched.bundles["/teams"] || [];
        for (const t of (teams || []).slice(0, 200)) {
          const mapped = mapSourceTeam("cbb", t, y);
          if (mapped.ok) await upsertTeamSeasonIdentity(env, mapped);
        }
        const catalog = indexCbbdAdjusted(fetched.bundles["/ratings/adjusted"] || []);
        gamesDiscovered += catalog.n;
        writes.writesSucceeded += await persistTeamFeatures(env, "cbb", y, catalog, id);
      }
    }

    if (job === "cfb-postgame-harvest" || job === "cbb-postgame-harvest") {
      const sport = job.startsWith("cfb") ? "cfb" : "cbb";
      const date = opts.date || shiftDateCT(todayCT(), -1);
      const path = "/games";
      const query = sport === "cfb" ? { year: yearCfb, seasonType: "regular" } : { season: yearCbb, startDateRange: date, endDateRange: date };
      const res = sport === "cfb" ? await cfbdGet(path, env, { query }) : await cbbdGet(path, env, { query });
      report.push(collegePublicResult(res));
      const finals = (res.data || []).filter((g) => (g.homePoints ?? g.home_points ?? g.homeScore) != null);
      gamesDiscovered = finals.length;
      const existing = await queryModelPredictions(env, { sport, ungraded: true, limit: 80 });
      for (const pred of existing) {
        const g = finals.find((x) => String(x.id || x.gameId) === String(pred.game_id));
        if (!g) continue;
        const hs = Number(g.homePoints ?? g.home_points ?? g.homeScore);
        const as = Number(g.awayPoints ?? g.away_points ?? g.awayScore);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        const grade = gradeScores(pred, hs, as);
        await gradeModelPrediction(env, { id: pred.id, actualHome: hs, actualAway: as, grade });
        writes.writesSucceeded += 1;
      }
      await persistObservation(env, { source: sport === "cfb" ? "cfbd" : "cbbd", sport, endpoint: path, season: sport === "cfb" ? yearCfb : yearCbb, partition: date, data: finals, jobRunId: id });
    }
  } catch (err) {
    errors.push(String(err?.message || err));
  }

  const failed = report.filter((r) => r && r.ok === false).length;
  const status = classifyJobStatus({
    okSports: failed === report.length && report.length ? 0 : 1,
    failedSports: failed && failed === report.length ? 1 : 0,
    writesFailed: 0,
    unbound: !hasDb(env),
    requiredFailed: errors.length > 0 && !report.length,
  });
  const quota = await queryQuota(env);
  const payload = jobPayload({
    ok: status === "success",
    job,
    status,
    triggerType: opts.trigger || "http",
    attemptedAt: started,
    successfulAt: status === "success" ? new Date().toISOString() : null,
    sports: [job.startsWith("cbb") ? "cbb" : job.startsWith("cfb") ? "cfb" : "college"],
    gamesDiscovered,
    writes,
    errors: errors.concat(report.filter((r) => r && !r.ok).map((r) => r.reason)).slice(0, 20),
    env,
    d1: { bound: hasDb(env), quota, endpoints: report, keyHealth: collegeKeyHealth(env) },
  });
  await recordJob(env, {
    id,
    jobType: job,
    triggerType: opts.trigger || "http",
    startedAt: started,
    completedAt: payload.successful_at || new Date().toISOString(),
    status: payload.status,
    sport: payload.sports[0],
    gamesDiscovered,
    writesAttempted: writes.writesSucceeded,
    writesSucceeded: writes.writesSucceeded,
    writesFailed: writes.writesFailed,
    env,
  });
  return payload;
}

function indexCfbRatings(bundles) {
  const sp = bundles["/ratings/sp"] || [];
  const byEspnId = {};
  const byCanonicalId = {};
  for (const row of sp) {
    const mapped = mapSourceTeam("cfb", row);
    const off = Number(row.offense?.rating ?? row.offensiveRating);
    const def = Number(row.defense?.rating ?? row.defensiveRating);
    if (!Number.isFinite(off) || !Number.isFinite(def)) continue;
    const rec = { off, def, sp: Number(row.rating), team: row.team, conference: row.conference, canonicalId: mapped.ok ? mapped.canonicalId : null };
    if (mapped.ok) {
      byCanonicalId[mapped.canonicalId] = rec;
      if (mapped.espnId) byEspnId[String(mapped.espnId)] = rec;
    }
  }
  return { byCanonicalId, byEspnId, n: sp.length };
}

export function gradeScores(pred, actualHome, actualAway) {
  const ah = Number(actualHome);
  const aa = Number(actualAway);
  const ph = Number(pred.proj_home ?? pred.projHome);
  const pa = Number(pred.proj_away ?? pred.projAway);
  if (![ah, aa, ph, pa].every(Number.isFinite)) return { ok: false };
  const actualTotal = ah + aa;
  const actualMargin = ah - aa;
  const projTotal = ph + pa;
  const projMargin = ph - pa;
  return {
    ok: true,
    errHome: ph - ah,
    errAway: pa - aa,
    errTotal: projTotal - actualTotal,
    errMargin: projMargin - actualMargin,
    winnerHit: (ph > pa) === (ah > aa),
  };
}

export { lookupCbbdRating, indexCbbdAdjusted };

const FREEZE_MODELS = {
  cfb: ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-ENRICHED-v1"],
  cbb: ["CBB-LEAGUE-BASELINE", "CBB-CBBD-RATINGS-v1"],
};

export async function persistGameChallengers(env, game, sport) {
  if (sport !== "cfb" && sport !== "cbb") return { ok: true, skipped: true };
  const keep = FREEZE_MODELS[sport] || [];
  const subset = {};
  for (const id of keep) {
    if (game?.challengers?.[id]) subset[id] = game.challengers[id];
  }
  const frozen = freezeChallengerPredictions(game, subset, { sport });
  let inserted = 0;
  let already = 0;
  for (const row of frozen) {
    const res = await insertModelPrediction(env, row);
    if (res.inserted) inserted += 1;
    else if (res.already) already += 1;
  }
  return { ok: true, inserted, already, kind: "challenger" };
}

export async function gradeGameChallengers(env, game, sport) {
  if (sport !== "cfb" && sport !== "cbb") return { ok: true, skipped: true };
  const hs = game?.home?.score;
  const as = game?.away?.score;
  if (hs == null || as == null) return { ok: true, skipped: true };
  const rows = await queryModelPredictions(env, { sport, gameId: String(game.id), ungraded: true, limit: 20 });
  for (const pred of rows) {
    await gradeModelPrediction(env, { id: pred.id, actualHome: hs, actualAway: as, grade: gradeScores(pred, hs, as) });
  }
  return { ok: true, graded: rows.length, kind: "challenger-grade" };
}

/**
 * Authenticated college research jobs. Each job is a separate Worker invocation.
 * Shadow models never auto-promote. Training does not run in this Worker.
 */

import { collegeKeyHealth, assertNoSecretLeak } from "./collegeSecrets.js";
import { cfbdGet, cbbdGet, cfbSeasonYear, cbbSeasonYear, summarizeSchema, collegePublicResult } from "./collegeApi.js";
import { queryQuota, insertSourceObservation, insertTeamFeatureSnapshot, insertGameFeatureSnapshot, insertModelPrediction, gradeModelPrediction, upsertModelRegistry, insertModelArtifact, insertValidationRun, insertPromotionDecision, upsertTeamSeasonIdentity, queryModelPredictions, queryEndpointUsage, upsertQbTransferHistory, insertCfbdEndpointAudit } from "./collegeStore.js";
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
import CFB_FBIS_V2 from "../../data/models/cfb-fbis-v2.js";
import { runCfbdEndpointAudit, auditArtifactPayload, auditContentHash } from "./cfbdEndpointAudit.js";
import { featureAvailabilityTable, markdownFeatureTable, FEATURE_CATALOG_VERSION } from "./cfbdFeatureCatalog.js";

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
  "cfb-qb-transfer-refresh",
  "cfbd-endpoint-audit",
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

const CFB_QB_STATS_ENDPOINTS = [
  ["/player/season/statistics", (y) => ({ year: y, category: "passing" })],
  ["/stats/player/season", (y) => ({ year: y, category: "passing" })],
  ["/player/usage", (y) => ({ year: y })],
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
    const publicResult = collegePublicResult(res);
    bundles[path] = res.ok ? res.data : [];
    const observed = await persistObservation(env, {
      source,
      sport,
      endpoint: path,
      season: year,
      partition: "season",
      data: res.ok ? res.data : [],
      jobRunId,
      status: res.ok ? "ok" : "failed",
    });
    publicResult.observationPersisted = Boolean(observed?.ok);
    publicResult.observationError = observed?.ok ? null : observed?.reason || "source_observation-unavailable";
    report.push(publicResult);
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
  await insertModelArtifact(env, { id: CFB_FBIS_V2.id, modelId: CFB_FBIS_V2.modelId, schema: CFB_FBIS_V2.expectedUnits, coefficients: CFB_FBIS_V2.coefficients, trainingCutoff: CFB_FBIS_V2.trainingCutoff, trainingHash: CFB_FBIS_V2.trainingHash, sourceVersions: CFB_FBIS_V2.sourceVersions, expectedUnits: CFB_FBIS_V2.expectedUnits });
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

    if (job === "cfbd-endpoint-audit") {
      const seasons = opts.seasons || [yearCfb, yearCfb - 1];
      const audit = await runCfbdEndpointAudit(env, {
        seasons,
        week: opts.week,
        probes: opts.probes,
        fetchFn: opts.fetchFn || fetch,
        jobRunId: id,
      });
      const catalogRows = featureAvailabilityTable(audit.byEndpoint || {});
      const artifact = auditArtifactPayload(audit);
      const contentHash = await auditContentHash(audit);
      let r2k = null;
      if (r2Bound(env)) {
        r2k = r2Key({
          kind: "audit",
          source: "cfbd",
          sport: "cfb",
          season: seasons[0],
          endpoint: "endpoint-audit",
          partition: contentHash.slice(0, 12),
          hash: contentHash.slice(0, 12),
          name: `cfbd-endpoint-audit-${contentHash.slice(0, 12)}.json`,
        });
        await putArchive(env, r2k, artifact);
      }
      await persistObservation(env, {
        source: "cfbd",
        sport: "cfb",
        endpoint: "cfbd-endpoint-audit",
        season: seasons[0],
        partition: "audit",
        data: artifact.endpoints,
        jobRunId: id,
        status: audit.summary?.configured ? "ok" : "auth-missing",
      });
      const inserted = await insertCfbdEndpointAudit(env, {
        id: `${id}:cfbd-audit`,
        auditedAt: audit.summary?.auditedAt || new Date().toISOString(),
        season: seasons[0],
        week: opts.week ?? null,
        jobRunId: id,
        summary: { ...audit.summary, catalogVersion: FEATURE_CATALOG_VERSION },
        endpoints: artifact.endpoints,
        catalogVersion: FEATURE_CATALOG_VERSION,
        contentHash,
        r2Key: r2k,
        featureTable: catalogRows,
      });
      if (inserted.ok) writes.writesSucceeded += 1;
      else writes.writesFailed += 1;
      assertNoSecretLeak(audit, env);
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: {
          bound: hasDb(env),
          audit: {
            summary: audit.summary,
            endpointCount: (audit.endpoints || []).length,
            classifications: audit.summary?.classifications || {},
            featureTableMarkdown: markdownFeatureTable(catalogRows),
            featureTable: catalogRows,
            r2Key: r2k,
            contentHash,
            note: "Safe diagnostics only. Empty responses are AVAILABLE-BUT-EMPTY, not unavailable. Champion unchanged.",
          },
        },
      });
      await recordJob(env, {
        id,
        jobType: job,
        triggerType: opts.trigger || "http",
        startedAt: started,
        completedAt: payload.successful_at,
        status: payload.status,
        sport: "cfb",
        writesAttempted: writes.writesSucceeded + writes.writesFailed,
        writesSucceeded: writes.writesSucceeded,
        writesFailed: writes.writesFailed,
        env,
      });
      return payload;
    }

    if (job === "model-train-validate") {
      const modelIds =
        opts.modelId && opts.modelId !== "all"
          ? [opts.modelId]
          : ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-REG-v1", "CFB-CFBD-ENSEMBLE-v1", "CFB-FBIS-v2"];
      const validation = [];
      for (const modelId of modelIds) {
        const rows = await queryModelPredictions(env, { sport: "cfb", modelId, limit: 5000 });
        const graded = rows.filter((r) => r.actual_home != null && r.actual_away != null);
        const metrics = evaluateValidationRows(graded);
        const folds = rollingOriginFolds(graded, 4);
        const foldMetrics = folds.map((fold) => ({
          trainN: fold.train.length,
          validateN: fold.validate.length,
          metrics: evaluateValidationRows(fold.validate),
        }));
        await insertValidationRun(env, {
          id: `${id}:val:${modelId}`,
          modelId,
          method: "rolling-origin-blocked",
          trainUntil: folds.at(-1)?.train.at(-1)?.frozen_at || null,
          validateFrom: folds.at(-1)?.validate[0]?.frozen_at || null,
          validateUntil: folds.at(-1)?.validate.at(-1)?.frozen_at || null,
          n: metrics.n,
          metrics: { ...metrics, folds: foldMetrics, ablation: modelIds.length > 1 },
          leakageOk: true,
        });
        validation.push({ modelId, metrics, folds: foldMetrics });
        writes.writesSucceeded += 1;
      }
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: {
          bound: hasDb(env),
          validation,
          note: "Validation uses frozen shadow predictions only; champion remains unchanged until explicit promotion decision.",
        },
      });
      await recordJob(env, {
        id,
        jobType: job,
        triggerType: opts.trigger || "http",
        startedAt: started,
        completedAt: payload.successful_at,
        status: payload.status,
        sport: "college",
        writesAttempted: writes.writesSucceeded,
        writesSucceeded: writes.writesSucceeded,
        writesFailed: writes.writesFailed,
        env,
      });
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

    if (job === "cfb-qb-transfer-refresh") {
      const seasons = opts.years || [yearCfb - 1, yearCfb];
      for (const y of seasons) {
        const portal = await cfbdGet("/player/portal", env, { query: { year: y } });
        report.push(collegePublicResult(portal));
        await persistObservation(env, {
          source: "cfbd",
          sport: "cfb",
          endpoint: "/player/portal",
          season: y,
          partition: "season",
          data: portal.ok ? portal.data : [],
          jobRunId: id,
          status: portal.ok ? "ok" : "failed",
        });
        let qbStats = { ok: false, data: [], reason: "qb-stats-endpoint-unavailable", status: 0, path: null };
        for (const [path, qf] of CFB_QB_STATS_ENDPOINTS) {
          const hit = await cfbdGet(path, env, { query: qf(y) });
          report.push(collegePublicResult(hit));
          await persistObservation(env, {
            source: "cfbd",
            sport: "cfb",
            endpoint: path,
            season: y,
            partition: "season",
            data: hit.ok ? hit.data : [],
            jobRunId: id,
            status: hit.ok ? "ok" : "failed",
          });
          if (hit.ok && Array.isArray(hit.data) && hit.data.length) {
            qbStats = hit;
            break;
          }
        }
        const inserted = await persistQbTransferSeason(env, {
          season: y,
          portalRows: portal.ok ? portal.data : [],
          qbStatRows: qbStats.ok ? qbStats.data : [],
          asOf: new Date().toISOString(),
        });
        writes.writesSucceeded += inserted.okRows;
        writes.writesFailed += inserted.failedRows;
        gamesDiscovered += inserted.okRows;
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

  const apiFailures = report.filter((r) => r && r.ok === false).length;
  const persistenceFailures = report.filter(
    (r) => r && (r.usagePersisted === false || r.observationPersisted === false)
  );
  if (persistenceFailures.length) {
    writes.writesFailed += persistenceFailures.length;
    errors.push(
      ...persistenceFailures.map((r) => {
        const parts = [
          r.usagePersisted === false ? r.usageError || "api-usage-not-persisted" : null,
          r.observationPersisted === false ? r.observationError || "source-observation-not-persisted" : null,
        ].filter(Boolean);
        return `${r.source || "college"} ${r.path || "unknown-endpoint"} persistence: ${parts.join(" | ")}`;
      })
    );
  }
  const status = classifyJobStatus({
    okSports: report.length > apiFailures ? 1 : 0,
    failedSports: apiFailures,
    writesFailed: writes.writesFailed,
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

function normalizeName(v = "") {
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function indexQbStats(rows = []) {
  const byId = new Map();
  const byName = new Map();
  for (const row of rows || []) {
    const id = row.playerId || row.player_id || row.athleteId || row.id || null;
    const name = row.player || row.playerName || row.name || row.athlete || "";
    const rec = {
      playerId: id ? String(id) : null,
      playerName: name || null,
      gamesStarted: num(row.gamesStarted ?? row.starts ?? row.games),
      passAttempts: num(row.passAttempts ?? row.attempts),
      usage: num(row.usage ?? row.usagePct ?? row.percent),
      passingPpa: num(row.passingPpa ?? row.ppa ?? row.epaPerPlay),
      passingWepa: num(row.passingWepa ?? row.wepa),
      successRate: num(row.successRate ?? row.success),
      explosiveRate: num(row.explosiveRate ?? row.explosive),
      sackRate: num(row.sackRate ?? row.sacksPerDropback),
      turnoverRate: num(row.turnoverRate ?? row.turnoversPerPlay ?? row.intRate),
      ypa: num(row.yardsPerAttempt ?? row.ypa),
      sourceSchool: row.team || row.school || row.schoolName || null,
      season: num(row.year ?? row.season),
    };
    if (rec.playerId) byId.set(rec.playerId, rec);
    const key = normalizeName(name);
    if (key) byName.set(key, rec);
  }
  return { byId, byName };
}

async function persistQbTransferSeason(env, { season, portalRows = [], qbStatRows = [], asOf }) {
  const idx = indexQbStats(qbStatRows);
  let okRows = 0;
  let failedRows = 0;
  for (const row of portalRows || []) {
    const pos = String(row.position || row.pos || row.positionGroup || "").toUpperCase();
    if (pos !== "QB" && !/QUARTERBACK/.test(pos)) continue;
    const direction = String(row.direction || row.type || row.movement || "").toLowerCase();
    const incoming =
      /\b(in|incoming|arrive|arriving|destination|commit|committed)\b/.test(direction) ||
      Boolean(row.destination || row.destinationTeam || row.newSchool || row.toTeam);
    if (!incoming) continue;
    const playerId = row.playerId || row.athleteId || row.id || null;
    const playerName = row.player || row.playerName || row.athlete || row.name || "";
    const stat =
      (playerId ? idx.byId.get(String(playerId)) : null) || idx.byName.get(normalizeName(playerName)) || null;
    const sourceSchool = row.origin || row.originSchool || row.previousSchool || row.fromTeam || stat?.sourceSchool || null;
    const destinationSchool = row.destination || row.destinationTeam || row.newSchool || row.toTeam || row.team || null;
    const rec = {
      id: `cfb:qb-transfer:${season}:${playerId || normalizeName(playerName)}:${normalizeName(destinationSchool || "")}`,
      playerId: playerId ? String(playerId) : null,
      playerName: playerName || stat?.playerName || null,
      season,
      sourceSchool,
      sourceTeamId: row.originTeamId || row.fromTeamId || null,
      destinationSchool,
      destinationTeamId: row.destinationTeamId || row.toTeamId || null,
      position: "QB",
      transferDate: row.transferDate || row.date || null,
      gamesStarted: stat?.gamesStarted ?? null,
      passAttempts: stat?.passAttempts ?? null,
      usage: stat?.usage ?? null,
      passingPpa: stat?.passingPpa ?? null,
      passingWepa: stat?.passingWepa ?? null,
      successRate: stat?.successRate ?? null,
      explosiveRate: stat?.explosiveRate ?? null,
      sackRate: stat?.sackRate ?? null,
      turnoverRate: stat?.turnoverRate ?? null,
      ypa: stat?.ypa ?? null,
      asOf,
      source: "cfbd",
      sourceObsId: null,
    };
    const out = await upsertQbTransferHistory(env, rec);
    if (out.ok) okRows += 1;
    else failedRows += 1;
  }
  return { okRows, failedRows };
}

const FREEZE_MODELS = {
  cfb: ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-REG-v1", "CFB-CFBD-ENSEMBLE-v1", "CFB-FBIS-v2"],
  cbb: ["CBB-LEAGUE-BASELINE", "CBB-CBBD-RATINGS-v1", "CBB-FBIS-PURE"],
  nfl: ["NFL-TEAM-FORM-v0", "NFL-FBIS-PURE"],
};

export async function persistGameChallengers(env, game, sport) {
  if (sport !== "cfb" && sport !== "cbb" && sport !== "nfl") return { ok: true, skipped: true };
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
  if (sport !== "cfb" && sport !== "cbb" && sport !== "nfl") return { ok: true, skipped: true };
  const hs = game?.home?.score;
  const as = game?.away?.score;
  if (hs == null || as == null) return { ok: true, skipped: true };
  const rows = await queryModelPredictions(env, { sport, gameId: String(game.id), ungraded: true, limit: 20 });
  for (const pred of rows) {
    await gradeModelPrediction(env, { id: pred.id, actualHome: hs, actualAway: as, grade: gradeScores(pred, hs, as) });
  }
  return { ok: true, graded: rows.length, kind: "challenger-grade" };
}

function evaluateValidationRows(rows = []) {
  const n = rows.length;
  if (!n) {
    return {
      n: 0,
      maeTotal: null,
      maeMargin: null,
      winnerHit: null,
      brierHomeWin: null,
      logLossHomeWin: null,
    };
  }
  let sumAbsTotal = 0;
  let sumAbsMargin = 0;
  let winnerHitN = 0;
  let brier = 0;
  let logLoss = 0;
  for (const r of rows) {
    const ph = Number(r.proj_home);
    const pa = Number(r.proj_away);
    const ah = Number(r.actual_home);
    const aa = Number(r.actual_away);
    if (![ph, pa, ah, aa].every(Number.isFinite)) continue;
    sumAbsTotal += Math.abs((ph + pa) - (ah + aa));
    sumAbsMargin += Math.abs((ph - pa) - (ah - aa));
    const predHome = ph > pa;
    const actualHome = ah > aa;
    if (predHome === actualHome) winnerHitN += 1;
    const p = Math.max(0.001, Math.min(0.999, Number(r.p_home_win) || (predHome ? 0.55 : 0.45)));
    const y = actualHome ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n,
    maeTotal: sumAbsTotal / n,
    maeMargin: sumAbsMargin / n,
    winnerHit: winnerHitN / n,
    brierHomeWin: brier / n,
    logLossHomeWin: logLoss / n,
  };
}

function rollingOriginFolds(rows = [], k = 4) {
  const ordered = [...rows].sort((a, b) => String(a.frozen_at || "").localeCompare(String(b.frozen_at || "")));
  if (ordered.length < k * 2) return [];
  const foldSize = Math.max(1, Math.floor(ordered.length / (k + 1)));
  const out = [];
  for (let i = 1; i <= k; i++) {
    const split = foldSize * i;
    const train = ordered.slice(0, split);
    const validate = ordered.slice(split, split + foldSize);
    if (!train.length || !validate.length) continue;
    out.push({ train, validate });
  }
  return out;
}

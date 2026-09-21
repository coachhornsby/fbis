/**
 * Compact D1 persistence for college research. Immutable inserts.
 * Outcomes may attach later without rewriting frozen inputs.
 */

import { hasDb } from "./store.js";
import { quotaHealth, utcMonthKey } from "./quota.js";

function n(v) {
  return v == null || v === "" ? null : v;
}

function json(v) {
  if (v == null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

export async function recordApiUsage(env, row) {
  if (!hasDb(env) || !row) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT INTO api_usage (
        source, endpoint, month, captured_at, cache_hit, http_status,
        records_returned, quota_cost, ok, reason, query_keys, elapsed_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.source,
        row.endpoint,
        row.month || utcMonthKey(),
        row.capturedAt || new Date().toISOString(),
        row.cacheHit ? 1 : 0,
        n(row.httpStatus),
        n(row.recordsReturned),
        n(row.quotaCost),
        row.ok ? 1 : 0,
        n(row.reason),
        n(row.queryKeys),
        n(row.elapsedMs)
      )
      .run();
    return { ok: true };
  } catch {
    return { ok: false, reason: "api_usage-unavailable" };
  }
}

export async function queryQuota(env, { month = utcMonthKey() } = {}) {
  if (!hasDb(env)) return quotaHealth({ used: 0, month, configured: false });
  try {
    const row = await env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN cache_hit = 0 THEN quota_cost ELSE 0 END), 0) AS used,
         COALESCE(SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END), 0) AS cache_hits
       FROM api_usage WHERE month = ? AND source IN ('cfbd','cbbd')`
    )
      .bind(month)
      .first();
    return quotaHealth({ used: Number(row?.used) || 0, cacheHits: Number(row?.cache_hits) || 0, month });
  } catch {
    return quotaHealth({ used: 0, month });
  }
}

export async function insertSourceObservation(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO source_observations (
        id, source, sport, endpoint, season, partition_key, observed_at, retrieved_at,
        schema_version, record_count, content_hash, r2_key, status, job_run_id, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.source,
        row.sport,
        row.endpoint,
        n(row.season),
        n(row.partitionKey),
        row.observedAt || new Date().toISOString(),
        row.retrievedAt || new Date().toISOString(),
        n(row.schemaVersion),
        n(row.recordCount),
        n(row.contentHash),
        n(row.r2Key),
        row.status || "ok",
        n(row.jobRunId),
        json(row.meta)
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertTeamFeatureSnapshot(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO team_feature_snapshots (
        id, sport, team_id, season, as_of, feature_version, features_json,
        missingness_json, content_hash, job_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.sport,
        row.teamId,
        n(row.season),
        row.asOf,
        row.featureVersion,
        json(row.features),
        json(row.missingness),
        n(row.contentHash),
        n(row.jobRunId),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertGameFeatureSnapshot(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO game_feature_snapshots (
        id, sport, game_id, home_team_id, away_team_id, scheduled_start, feature_cutoff,
        source_obs_json, source_versions_json, feature_schema_version, model_version,
        neutral, missingness_json, data_quality, content_hash, job_run_id, features_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.sport,
        row.gameId,
        n(row.homeTeamId),
        n(row.awayTeamId),
        n(row.scheduledStart),
        row.featureCutoff,
        json(row.sourceObs),
        json(row.sourceVersions),
        row.featureSchemaVersion,
        n(row.modelVersion),
        row.neutral ? 1 : 0,
        json(row.missingness),
        n(row.dataQuality),
        n(row.contentHash),
        n(row.jobRunId),
        json(row.features),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertModelPrediction(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO model_predictions (
        id, sport, game_id, model_id, model_version, role, feature_snapshot_id,
        proj_home, proj_away, proj_margin, proj_total, p_home_win, p_cover, p_over,
        sigma_margin, sigma_total, market_informed, can_qualify, frozen_at, content_hash,
        actual_home, actual_away, graded_at, grade_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.sport,
        row.gameId,
        row.modelId,
        row.modelVersion,
        row.role || "shadow",
        n(row.featureSnapshotId),
        n(row.projHome),
        n(row.projAway),
        n(row.projMargin),
        n(row.projTotal),
        n(row.pHomeWin),
        n(row.pCover),
        n(row.pOver),
        n(row.sigmaMargin),
        n(row.sigmaTotal),
        row.marketInformed ? 1 : 0,
        row.canQualify ? 1 : 0,
        row.frozenAt || new Date().toISOString(),
        n(row.contentHash),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt),
        json(row.grade)
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function gradeModelPrediction(env, { id, actualHome, actualAway, grade }) {
  if (!hasDb(env) || !id) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `UPDATE model_predictions
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           graded_at = COALESCE(graded_at, ?),
           grade_json = COALESCE(grade_json, ?)
       WHERE id = ?`
    )
      .bind(n(actualHome), n(actualAway), new Date().toISOString(), json(grade), id)
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function upsertModelRegistry(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `INSERT INTO model_registry (
        id, sport, name, version, role, family, can_qualify, market_informed,
        artifact_id, criteria_json, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        artifact_id = excluded.artifact_id,
        criteria_json = excluded.criteria_json`
    )
      .bind(
        row.id,
        row.sport,
        row.name,
        row.version,
        row.role,
        n(row.family),
        row.canQualify ? 1 : 0,
        row.marketInformed ? 1 : 0,
        n(row.artifactId),
        json(row.criteria),
        row.createdAt || new Date().toISOString(),
        row.status || "shadow"
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertModelArtifact(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO model_artifacts (
        id, model_id, schema_json, coefficients_json, training_cutoff, training_hash,
        source_versions_json, validation_key, expected_units_json, r2_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.modelId,
        json(row.schema),
        json(row.coefficients),
        n(row.trainingCutoff),
        n(row.trainingHash),
        json(row.sourceVersions),
        n(row.validationKey),
        json(row.expectedUnits),
        n(row.r2Key),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertValidationRun(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_validation_runs (
        id, model_id, method, train_until, validate_from, validate_until,
        n, metrics_json, leakage_ok, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.modelId,
        row.method || "rolling-origin",
        n(row.trainUntil),
        n(row.validateFrom),
        n(row.validateUntil),
        n(row.n),
        json(row.metrics),
        row.leakageOk === false ? 0 : 1,
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertPromotionDecision(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_promotion_decisions (
        id, model_id, decision, operator_approved, criteria_json, evidence_json,
        reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.modelId,
        row.decision,
        row.operatorApproved ? 1 : 0,
        json(row.criteria),
        json(row.evidence),
        n(row.reason),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function upsertTeamSeasonIdentity(env, row) {
  if (!hasDb(env) || !row?.canonicalId || row.season == null) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `INSERT INTO team_season_identity (
        canonical_id, sport, season, source_team_id, espn_id, school, display_name,
        abbr, conference, classification, aliases_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_id, season) DO UPDATE SET
        conference = excluded.conference,
        source_team_id = COALESCE(excluded.source_team_id, team_season_identity.source_team_id),
        classification = COALESCE(excluded.classification, team_season_identity.classification),
        updated_at = excluded.updated_at`
    )
      .bind(
        row.canonicalId,
        row.sport,
        row.season,
        n(row.sourceTeamId),
        n(row.espnId),
        n(row.school),
        n(row.displayName),
        n(row.abbr),
        n(row.conference),
        n(row.classification),
        json(row.aliases),
        new Date().toISOString()
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}


export async function insertModelLearningFinding(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const now = row.updatedAt || row.createdAt || new Date().toISOString();
    const res = await env.DB.prepare(
      \`INSERT OR IGNORE INTO model_learning_findings (
        id, sport, model_id, finding_type, slice_key, metric,
        baseline_n, recent_n, baseline_value, recent_value, delta,
        severity, window_start, window_end, evidence_json, hypothesis,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`
    )
      .bind(
        row.id,
        row.sport,
        row.modelId,
        row.findingType,
        n(row.sliceKey),
        row.metric,
        n(row.baselineN),
        n(row.recentN),
        n(row.baselineValue),
        n(row.recentValue),
        n(row.delta),
        row.severity,
        n(row.windowStart),
        n(row.windowEnd),
        json(row.evidence || {}),
        n(row.hypothesis),
        row.status || "OPEN",
        row.createdAt || now,
        now
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryModelLearningFindings(
  env,
  { sport = null, modelId = null, status = null, limit = 200 } = {}
) {
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM model_learning_findings WHERE 1=1";
    const binds = [];
    if (sport) {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (modelId) {
      sql += " AND model_id = ?";
      binds.push(modelId);
    }
    if (status) {
      sql += " AND status = ?";
      binds.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    binds.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function queryModelPredictions(env, { sport, modelId, gameId, ungraded = false, limit = 200 } = {}) {
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM model_predictions WHERE 1=1";
    const binds = [];
    if (sport) {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (modelId) {
      sql += " AND model_id = ?";
      binds.push(modelId);
    }
    if (gameId) {
      sql += " AND game_id = ?";
      binds.push(gameId);
    }
    if (ungraded) sql += " AND actual_home IS NULL";
    sql += " ORDER BY frozen_at DESC LIMIT ?";
    binds.push(limit);
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function queryTableCounts(env, tables = []) {
  if (!hasDb(env)) return {};
  const out = {};
  for (const t of tables) {
    try {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      out[t] = Number(row?.n) || 0;
    } catch {
      out[t] = null;
    }
  }
  return out;
}

export async function queryEndpointUsage(env, { month = utcMonthKey() } = {}) {
  if (!hasDb(env)) return [];
  try {
    const res = await env.DB.prepare(
      `SELECT source, endpoint,
              COUNT(*) AS calls,
              SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cache_hits,
              SUM(CASE WHEN cache_hit = 0 THEN quota_cost ELSE 0 END) AS quota_cost,
              SUM(records_returned) AS records
       FROM api_usage WHERE month = ?
       GROUP BY source, endpoint
       ORDER BY source, endpoint`
    )
      .bind(month)
      .all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function upsertQbTransferHistory(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "no-id" };
  try {
    await env.DB.prepare(
      `INSERT INTO qb_transfer_history (
        id, player_id, player_name, season, source_school, source_team_id, destination_school, destination_team_id,
        position, transfer_date, games_started, pass_attempts, usage, passing_ppa, passing_wepa, success_rate,
        explosive_rate, sack_rate, turnover_rate, ypa, as_of, source, source_obs_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_school = COALESCE(excluded.source_school, qb_transfer_history.source_school),
        destination_school = COALESCE(excluded.destination_school, qb_transfer_history.destination_school),
        games_started = COALESCE(excluded.games_started, qb_transfer_history.games_started),
        pass_attempts = COALESCE(excluded.pass_attempts, qb_transfer_history.pass_attempts),
        usage = COALESCE(excluded.usage, qb_transfer_history.usage),
        passing_ppa = COALESCE(excluded.passing_ppa, qb_transfer_history.passing_ppa),
        passing_wepa = COALESCE(excluded.passing_wepa, qb_transfer_history.passing_wepa),
        success_rate = COALESCE(excluded.success_rate, qb_transfer_history.success_rate),
        explosive_rate = COALESCE(excluded.explosive_rate, qb_transfer_history.explosive_rate),
        sack_rate = COALESCE(excluded.sack_rate, qb_transfer_history.sack_rate),
        turnover_rate = COALESCE(excluded.turnover_rate, qb_transfer_history.turnover_rate),
        ypa = COALESCE(excluded.ypa, qb_transfer_history.ypa),
        as_of = excluded.as_of,
        source_obs_id = COALESCE(excluded.source_obs_id, qb_transfer_history.source_obs_id),
        updated_at = excluded.updated_at`
    )
      .bind(
        row.id,
        n(row.playerId),
        n(row.playerName),
        n(row.season),
        n(row.sourceSchool),
        n(row.sourceTeamId),
        n(row.destinationSchool),
        n(row.destinationTeamId),
        n(row.position),
        n(row.transferDate),
        n(row.gamesStarted),
        n(row.passAttempts),
        n(row.usage),
        n(row.passingPpa),
        n(row.passingWepa),
        n(row.successRate),
        n(row.explosiveRate),
        n(row.sackRate),
        n(row.turnoverRate),
        n(row.ypa),
        row.asOf || new Date().toISOString(),
        row.source || "cfbd",
        n(row.sourceObsId),
        new Date().toISOString()
      )
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryQbTransferHistory(env, { season = null, destinationSchool = null, limit = 500 } = {}) {
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM qb_transfer_history WHERE 1=1";
    const binds = [];
    if (season != null) {
      sql += " AND season = ?";
      binds.push(Number(season));
    }
    if (destinationSchool) {
      sql += " AND lower(destination_school) = ?";
      binds.push(String(destinationSchool).toLowerCase());
    }
    sql += " ORDER BY season DESC, updated_at DESC LIMIT ?";
    binds.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return res.results || [];
  } catch {
    return [];
  }
}

export async function insertCfbdEndpointAudit(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO cfbd_endpoint_audit (
        id, audited_at, season, week, job_run_id, summary_json, endpoints_json,
        catalog_version, feature_table_json, content_hash, r2_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.auditedAt || new Date().toISOString(),
        n(row.season),
        n(row.week),
        n(row.jobRunId),
        json(row.summary),
        json(row.endpoints),
        n(row.catalogVersion),
        json(row.featureTable),
        n(row.contentHash),
        n(row.r2Key),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertCfbPregameFeatureVector(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO cfb_pregame_feature_vectors (
        id, game_id, season, week, kickoff_timestamp, home_team, away_team,
        feature_as_of_timestamp, feature_cutoff_timestamp, source_version, source_endpoint,
        collection_timestamp, features_json, decomposition_json, uncertainty_json,
        model_id, content_hash, job_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        n(row.season),
        n(row.week),
        n(row.kickoffTimestamp),
        n(row.homeTeam),
        n(row.awayTeam),
        row.featureAsOfTimestamp,
        row.featureCutoffTimestamp,
        n(row.sourceVersion),
        n(row.sourceEndpoint),
        row.collectionTimestamp,
        json(row.features),
        json(row.decomposition),
        json(row.uncertainty),
        n(row.modelId),
        n(row.contentHash),
        n(row.jobRunId),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0, already: res.meta?.changes ? 0 : 1 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertCfbPlayerRoleSnapshot(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO cfb_player_role_snapshots (
        id, game_id, season, week, season_type, kickoff_timestamp, team, side, role,
        player_id, player_name, position, role_confidence, identity_as_of,
        feature_cutoff_timestamp, selection_json, provenance_json, model_version,
        content_hash, job_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        n(row.season),
        n(row.week),
        n(row.seasonType),
        n(row.kickoffTimestamp),
        row.team,
        row.side,
        row.role,
        n(row.playerId),
        n(row.playerName),
        n(row.position),
        n(row.roleConfidence),
        row.identityAsOf,
        row.featureCutoffTimestamp,
        json(row.selection),
        json(row.provenance),
        n(row.modelVersion),
        n(row.contentHash),
        n(row.jobRunId),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertCfbPlayerProjection(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO cfb_player_projections (
        id, game_id, season, week, kickoff_timestamp, team, side, role, player_id, player_name,
        market_type, projection, median, sigma, quantiles_json, data_quality, sample_size,
        uncertainty_state, model_id, model_version, game_model_id, game_model_version,
        feature_cutoff_timestamp, feature_as_of_timestamp, provenance_json, coherence_json,
        content_hash, job_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        n(row.season),
        n(row.week),
        n(row.kickoffTimestamp),
        row.team,
        row.side,
        row.role,
        n(row.playerId),
        n(row.playerName),
        row.marketType,
        n(row.projection),
        n(row.median),
        n(row.sigma),
        json(row.quantiles),
        n(row.dataQuality),
        n(row.sampleSize),
        n(row.uncertaintyState),
        row.modelId,
        n(row.modelVersion),
        n(row.gameModelId),
        n(row.gameModelVersion),
        row.featureCutoffTimestamp,
        n(row.featureAsOfTimestamp),
        json(row.provenance),
        json(row.coherence),
        n(row.contentHash),
        n(row.jobRunId),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function insertCfbPropMarketLine(env, row) {
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO cfb_prop_market_lines (
        id, game_id, player_id, player_name, team, market_type, line, over_price, under_price,
        source, sportsbook, observed_at, market_quality, import_mode, payload_json, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        n(row.playerId),
        n(row.playerName),
        n(row.team),
        row.marketType,
        row.line,
        n(row.overPrice),
        n(row.underPrice),
        row.source,
        n(row.sportsbook),
        row.observedAt,
        n(row.marketQuality),
        n(row.importMode),
        json(row.payload),
        n(row.contentHash),
        row.createdAt || new Date().toISOString()
      )
      .run();
    return { ok: true, inserted: res.meta?.changes ? 1 : 0 };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

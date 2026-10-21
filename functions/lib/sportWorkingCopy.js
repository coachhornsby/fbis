/**
 * Generic sport working-set copy + shadow validation.
 * Copies from PRIMARY into a sport D1 without changing product authority.
 * Never deletes primary rows. Never sets mode=sport.
 *
 * Pagination is deterministic keyset-by-id so repeated runs reach older rows
 * (CFB predictions exceed a single LIMIT page).
 */
import { resolveSportDb, SPORT_DATABASES, productSportDbHandle } from "./databaseTopology.js";
// SPORT_PREFIX_TABLES keys must stay aligned with SPORT_DATABASES (all 11 sports).
import {
  buildPredictionEvidenceEnvelope,
  evaluateSportPredictionFidelity,
} from "./canonicalEvidenceContract.js";

export const SPORT_WORKING_TABLES = Object.freeze([
  Object.freeze({ table: "games" }),
  Object.freeze({ table: "prediction_snapshots" }),
  Object.freeze({ table: "published_projections" }),
]);

/**
 * Sport-prefixed research tables to copy in shadow (Wave 1–2).
 * Player-prop tables are intentionally omitted (separate Props workstream).
 */
export const SPORT_PREFIX_TABLES = Object.freeze({
  nfl: Object.freeze([
    "nfl_team_profiles",
    "nfl_team_profile_snapshots",
    "nfl_team_schedule_profile",
    "nfl_team_coach_history",
    "nfl_profile_sync_runs",
    "nfl_player_profiles",
    "nfl_player_state_events",
    "nfl_research_publications",
    "nfl_research_publication_events",
    "nfl_qb_personnel_shadow_predictions",
    "nfl_wager_decisions",
    "nfl_wager_outcomes",
  ]),
  cfb: Object.freeze([
    "cfb_canonical_teams",
    "cfb_canonical_players",
    "cfb_conference_membership",
    "cfb_team_aliases",
    "cfb_team_provider_ids",
    "cfb_player_aliases",
    "cfb_player_provider_ids",
    "cfb_roster_membership",
    "cfb_roster_observations",
    "cfb_roster_source_coverage",
    "cfb_pregame_feature_vectors",
    "cfb_player_role_snapshots",
    "cfb_core_weekly_archive",
    "cfb_core_shadow_predictions",
    "cfb_tier3_training_snapshots",
    "cfb_tier3_training_games",
    "cfb_hfa_ratings",
    "cfb_hfa_games",
  ]),
  nhl: Object.freeze([
    "nhl_team_profiles",
    "nhl_team_profile_snapshots",
    "nhl_team_schedule_profile",
    "nhl_team_coach_history",
    "nhl_profile_sync_runs",
    "nhl_player_profiles",
    "nhl_goalie_profiles",
    "nhl_linemate_profiles",
    "nhl_deployment_observations",
    "nhl_goalie_probability_shadow",
    "nhl_bookmaker_quote_evidence",
    "nhl_wager_decisions",
    "nhl_wager_settlements",
    "nhl_wager_confidence_runs",
  ]),
  nba: Object.freeze([
    "nba_team_profiles",
    "nba_team_profile_snapshots",
    "nba_team_schedule_items",
    "nba_team_coach_history",
    "nba_player_state_profiles",
    "nba_player_state_events",
    "nba_player_role_contexts",
    "nba_player_impact_snapshots",
    "nba_player_impact_benchmarks",
    "nba_game_features",
    "nba_game_projections",
    "nba_game_market_evaluations",
    "nba_lineup_observations",
    "nba_official_availability_reports",
    "nba_observation_health",
    "nba_wager_decisions",
    "nba_qualification_state",
    "nba_confidence_calibration",
  ]),
  mlb: Object.freeze([
    "mlb_team_profiles",
    "mlb_team_profile_snapshots",
    "mlb_team_schedule_items",
    "mlb_hitter_profiles",
    "mlb_pitcher_profiles",
    "mlb_player_state_profiles",
    "mlb_profile_refresh_state",
    "mlb_market_projections",
    "mlb_bookmaker_quote_evidence",
  ]),
  cbb: Object.freeze([
    "cbb_canonical_teams",
    "cbb_conference_membership",
    "cbb_team_aliases",
    "cbb_players",
    "cbb_player_aliases",
    "cbb_player_provider_ids",
    "cbb_roster_membership",
    "cbb_roster_observations",
    "cbb_schedule_items",
    "cbb_team_profile_snapshots",
    "cbb_team_state_snapshots",
    "cbb_player_state_snapshots",
    "cbb_game_state_snapshots",
    "cbb_availability_observations",
  ]),
  wnba: Object.freeze([
    "wnba_player_role_contexts",
    "wnba_player_impact_snapshots",
    "wnba_team_possession_feature_snapshots",
    "wnba_wager_decisions",
  ]),
  soccer: Object.freeze([
    "soccer_matches",
    "soccer_competition_coverage",
    "soccer_competition_provider_map",
    "soccer_team_state",
    "soccer_team_state_snapshots",
    "soccer_player_state",
    "soccer_player_state_snapshots",
    "soccer_availability_observations",
    "soccer_research_routes",
    "soccer_prospective_shadow",
  ]),
  tennis: Object.freeze([
    "tennis_players",
    "tennis_player_aliases",
    "tennis_player_source_ids",
    "tennis_player_profiles_current",
    "tennis_player_bank",
    "tennis_official_matches",
    "tennis_official_match_observations",
    "tennis_external_fixtures",
    "tennis_ranking_observations",
    "tennis_match_history",
    "tennis_context_snapshots",
    "tennis_market_snapshots",
    "tennis_availability_observations",
  ]),
  // Shared Asian baseball history is league-scoped in PRIMARY. These rows
  // are split into the two independent sport D1s by WHERE league=? on copy
  // and on parity; never copy the other league into the destination.
  npb: Object.freeze([
    "asian_baseball_games",
    "asian_baseball_game_observations",
    "asian_baseball_pregame_snapshots",
    "asian_baseball_park_factors",
    "asian_baseball_game_provider_crosswalk",
    "asian_baseball_player_identities",
    "asian_baseball_player_game_observations",
  ]),
  kbo: Object.freeze([
    "asian_baseball_games",
    "asian_baseball_game_observations",
    "asian_baseball_pregame_snapshots",
    "asian_baseball_park_factors",
    "asian_baseball_game_provider_crosswalk",
    "asian_baseball_player_identities",
    "asian_baseball_player_game_observations",
  ]),
});

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 50;

async function count(db, sql, ...params) {
  if (!db?.prepare) return null;
  try {
    const stmt = db.prepare(sql);
    const row = params.length
      ? await stmt.bind(...params).first()
      : (typeof stmt.first === "function" ? await stmt.first() : await stmt.bind().first());
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

async function metaGet(sportDb, key) {
  try {
    const row = await sportDb.prepare(
      "SELECT value_text FROM fbis_sport_shard_meta WHERE key=? LIMIT 1"
    ).bind(key).first();
    return row?.value_text || null;
  } catch {
    return null;
  }
}

async function metaSet(sportDb, key, value) {
  try {
    await sportDb.prepare(
      `INSERT OR REPLACE INTO fbis_sport_shard_meta(key,value_text,updated_at) VALUES(?,?,datetime('now'))`
    ).bind(key, String(value)).run();
  } catch {
    /* meta is best-effort */
  }
}

function stablePredictionId(row) {
  return row.id || `${row.game_id}|${row.frozen_at}|${row.model_version || ""}|${row.projection_kind || ""}`;
}

function stablePublishedId(row) {
  if (row.id != null && String(row.id).length > 0 && Number.isNaN(Number(row.id)) === false) {
    // Primary uses INTEGER autoincrement — compose a durable sport-side key.
    return `${row.sport}|${row.game_id}|${row.model_version || ""}|${row.published_at || ""}`;
  }
  if (row.id != null && String(row.id).includes("|")) return String(row.id);
  return `${row.sport}|${row.game_id}|${row.model_version || ""}|${row.published_at || ""}`;
}

/**
 * IDs can sort before a saved high-water mark when PRIMARY receives late writes.
 * A high-water cursor by itself cannot detect those omissions. When the source
 * has more rows, start an idempotent full keyset replay; persist an in-progress
 * marker so bounded runs for CFB/large sports continue instead of restarting.
 * No source records are deleted, and this never changes sport authority.
 */
export function planSportShadowCursorRecovery({
  primaryCount, sportCount, resumeCursor = "", replayActive = false,
} = {}) {
  const countsValid = Number.isInteger(primaryCount) && Number.isInteger(sportCount);
  const missing = countsValid && primaryCount > sportCount;
  const startReplay = missing && !replayActive;
  return {
    cursor: startReplay ? "" : String(resumeCursor || ""),
    replayActive: replayActive || startReplay,
    startReplay,
    missingCount: missing ? primaryCount - sportCount : 0,
  };
}

async function beginSportWorkingCopy(primary, sportDb, sport, table, resume) {
  if (!resume) return { cursor: "", replayActive: false, startReplay: false };
  const cursorKey = `copy_cursor_${table}`;
  const replayKey = `copy_replay_active_${table}`;
  const resumeCursor = (await metaGet(sportDb, cursorKey)) || "";
  const replayActive = (await metaGet(sportDb, replayKey)) === "1";
  const sql = `SELECT COUNT(*) n FROM ${table} WHERE sport=?`;
  const [primaryCount, sportCount] = await Promise.all([
    count(primary, sql, sport), count(sportDb, sql, sport),
  ]);
  const plan = planSportShadowCursorRecovery({
    primaryCount, sportCount, resumeCursor, replayActive,
  });
  if (plan.startReplay) {
    // Persist both markers before D1 copying, so interrupted retries resume
    // from the beginning rather than skipping earlier missing IDs.
    await metaSet(sportDb, cursorKey, "");
    await metaSet(sportDb, replayKey, "1");
  }
  return plan;
}

async function finishSportWorkingCopy(sportDb, table, plan, pass) {
  if (pass.cursor) await metaSet(sportDb, `copy_cursor_${table}`, pass.cursor);
  // Only clear after an exhausted scan. A new count discrepancy on a future
  // cycle will start another replay, catching late backfills below the cursor.
  if (plan.replayActive && pass.exhausted) {
    await metaSet(sportDb, `copy_replay_active_${table}`, "0");
  }
}

async function copyGamesPaged(primary, sportDb, sport, { pageSize, maxPages, afterId = "" }) {
  let cursor = afterId;
  let copied = 0;
  let pages = 0;
  let lastId = cursor;
  for (; pages < maxPages; pages += 1) {
    const page = await primary.prepare(
      `SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr,updated_at
       FROM games
       WHERE sport=? AND id>?
       ORDER BY id ASC
       LIMIT ?`
    ).bind(sport, cursor, pageSize).all();
    const rows = page?.results || [];
    if (!rows.length) break;
    for (const row of rows) {
      // Preserve any richer aux fields already on the sport shard (do not NULL-clobber).
      await sportDb.prepare(
        `INSERT INTO games(id,sport,start,status,home_name,away_name,home_abbr,away_abbr,home_id,away_id,season,week,venue,payload_json,updated_at)
         VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?)
         ON CONFLICT(id) DO UPDATE SET
           sport=excluded.sport,
           start=excluded.start,
           home_name=excluded.home_name,
           away_name=excluded.away_name,
           home_abbr=excluded.home_abbr,
           away_abbr=excluded.away_abbr,
           updated_at=excluded.updated_at,
           status=COALESCE(games.status, excluded.status),
           home_id=COALESCE(games.home_id, excluded.home_id),
           away_id=COALESCE(games.away_id, excluded.away_id),
           season=COALESCE(games.season, excluded.season),
           week=COALESCE(games.week, excluded.week),
           venue=COALESCE(games.venue, excluded.venue),
           payload_json=COALESCE(games.payload_json, excluded.payload_json)`
      ).bind(
        row.id, sport, row.start, null, row.home_name, row.away_name, row.home_abbr, row.away_abbr,
        row.updated_at || new Date().toISOString()
      ).run();
      copied += 1;
      lastId = row.id;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < pageSize) break;
  }
  return { copied, pages, cursor: lastId, exhausted: pages < maxPages || copied === 0 };
}

async function copyPredictionsPaged(primary, sportDb, sport, { pageSize, maxPages, afterId = "" }) {
  let cursor = afterId;
  let copied = 0;
  let pages = 0;
  let lastId = cursor;
  let fidelityFailures = 0;
  for (; pages < maxPages; pages += 1) {
    // Prefer complete PRIMARY row (SELECT *) so the evidence envelope is full-fidelity.
    // Fall back to rich then lean column lists on older schemas.
    let rows = [];
    try {
      const page = await primary.prepare(
        `SELECT * FROM prediction_snapshots
         WHERE sport=? AND id>?
         ORDER BY id ASC
         LIMIT ?`
      ).bind(sport, cursor, pageSize).all();
      rows = page?.results || [];
    } catch {
      try {
        const page = await primary.prepare(
          `SELECT id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,proj_margin,
                  p_home_final,p_market,frozen_at,weights_json,layers_json,projection_flags,
                  graded_at,actual_home,actual_away,deployment_commit,
                  date,matchup,checkpoint,pal_home,pal_away,pal_f5_home,pal_f5_away,pal_p_home,
                  pal_as_of,pal_request_id,pal_json,lineups_official,
                  p_espn,p_score,p_form,p_pal,data_quality,pin_home_ml,pin_away_ml,pin_vig,
                  engine,f5_actual_home,f5_actual_away,projection_state
           FROM prediction_snapshots
           WHERE sport=? AND id>?
           ORDER BY id ASC
           LIMIT ?`
        ).bind(sport, cursor, pageSize).all();
        rows = page?.results || [];
      } catch {
        const page = await primary.prepare(
          `SELECT id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
           FROM prediction_snapshots
           WHERE sport=? AND id>?
           ORDER BY id ASC
           LIMIT ?`
        ).bind(sport, cursor, pageSize).all();
        rows = page?.results || [];
      }
    }
    if (!rows.length) break;
    for (const row of rows) {
      const id = stablePredictionId(row);
      const envelope = buildPredictionEvidenceEnvelope(row);
      await sportDb.prepare(
        `INSERT INTO prediction_snapshots(
           id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,proj_margin,
           p_home_final,p_market,frozen_at,weights_json,layers_json,projection_flags,
           graded_at,actual_home,actual_away,deployment_commit,payload_json
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           game_id=excluded.game_id,
           sport=excluded.sport,
           model_version=excluded.model_version,
           projection_kind=excluded.projection_kind,
           proj_total=excluded.proj_total,
           proj_home=excluded.proj_home,
           proj_away=excluded.proj_away,
           proj_margin=excluded.proj_margin,
           p_home_final=excluded.p_home_final,
           p_market=excluded.p_market,
           frozen_at=excluded.frozen_at,
           weights_json=excluded.weights_json,
           layers_json=excluded.layers_json,
           projection_flags=excluded.projection_flags,
           graded_at=excluded.graded_at,
           actual_home=excluded.actual_home,
           actual_away=excluded.actual_away,
           deployment_commit=excluded.deployment_commit,
           payload_json=excluded.payload_json`
      ).bind(
        id, row.game_id, row.sport, row.model_version, row.projection_kind,
        row.proj_total, row.proj_home, row.proj_away, row.proj_margin ?? null,
        row.p_home_final, row.p_market ?? null, row.frozen_at,
        row.weights_json ?? null, row.layers_json ?? null, row.projection_flags ?? null,
        row.graded_at ?? null, row.actual_home ?? null, row.actual_away ?? null,
        row.deployment_commit ?? null, envelope
      ).run();
      const fidelity = evaluateSportPredictionFidelity({
        ...row, id, payload_json: envelope,
      });
      if (!fidelity.ok) fidelityFailures += 1;
      copied += 1;
      lastId = id;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < pageSize) break;
  }
  return {
    copied,
    pages,
    cursor: lastId,
    exhausted: pages < maxPages || copied === 0,
    fidelityFailures,
  };
}

async function copyPublishedPaged(primary, sportDb, sport, { pageSize, maxPages, afterKey = "" }) {
  let cursor = afterKey;
  let copied = 0;
  let pages = 0;
  let lastKey = cursor;
  for (; pages < maxPages; pages += 1) {
    // Keyset on (published_at, game_id, model_version) — primary id is INTEGER autoincrement.
    const page = await primary.prepare(
      `SELECT game_id,sport,model_version,published_at,published_by,payload_json,payload_hash
       FROM published_projections
       WHERE sport=?
         AND (published_at||'|'||game_id||'|'||COALESCE(model_version,'')) > ?
       ORDER BY published_at ASC, game_id ASC, model_version ASC
       LIMIT ?`
    ).bind(sport, cursor, pageSize).all();
    const rows = page?.results || [];
    if (!rows.length) break;
    for (const row of rows) {
      const id = stablePublishedId(row);
      await sportDb.prepare(
        `INSERT INTO published_projections(id,game_id,sport,model_version,published_at,published_by,payload_hash,payload_json)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           game_id=excluded.game_id,
           sport=excluded.sport,
           model_version=excluded.model_version,
           published_at=excluded.published_at,
           published_by=excluded.published_by,
           payload_hash=excluded.payload_hash,
           payload_json=excluded.payload_json`
      ).bind(
        id, row.game_id, row.sport, row.model_version || null, row.published_at,
        row.published_by || null, row.payload_hash || null, row.payload_json
      ).run();
      copied += 1;
      lastKey = `${row.published_at}|${row.game_id}|${row.model_version || ""}`;
    }
    const last = rows[rows.length - 1];
    cursor = `${last.published_at}|${last.game_id}|${last.model_version || ""}`;
    if (rows.length < pageSize) break;
  }
  return { copied, pages, cursor: lastKey, exhausted: pages < maxPages || copied === 0 };
}

export async function copySportWorkingTables(env, sport, {
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  limitPerTable = null,
  resume = true,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  if (!plan?.databaseId) return { ok: false, reason: "SPORT_DB_NOT_PROVISIONED", sport: key, canAuthorizeWager: false };
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, plan, canAuthorizeWager: false };

  // Refuse to pretend this is a cutover.
  const product = productSportDbHandle(env, key);
  if (product.productIoUsesSportDb) {
    return {
      ok: false,
      reason: "REFUSED_WHILE_SPORT_MODE_ACTIVE",
      detail: "Copy is a shadow migration tool; unset SPORT_DB_MODE before bulk copy.",
      sport: key,
      canAuthorizeWager: false,
    };
  }

  // Back-compat: limitPerTable ≈ pageSize * maxPages when callers pass the old knob.
  // Allow small pageSize for deterministic paging tests; production callers use defaults.
  const effectivePageSize = Math.min(2000, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  let effectiveMaxPages = Math.min(200, Math.max(1, Number(maxPages) || DEFAULT_MAX_PAGES));
  if (limitPerTable != null && Number.isFinite(Number(limitPerTable))) {
    effectiveMaxPages = Math.max(1, Math.ceil(Number(limitPerTable) / effectivePageSize));
  }

  const results = [];
  const checkpoints = {};
  const schemaHeals = [];

  // Heal lean sport-side working tables before INSERT (NBA/MLB stubs lack evidence cols).
  for (const table of ["games", "prediction_snapshots", "published_projections"]) {
    try {
      const heal = await ensureMirroredSportTable(primary, sportDb, table);
      if (heal.healed) schemaHeals.push({ table, addedColumns: heal.addedColumns || [] });
    } catch (error) {
      schemaHeals.push({
        table,
        ok: false,
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }

  try {
    const gamesPlan = await beginSportWorkingCopy(primary, sportDb, key, "games", resume);
    const games = await copyGamesPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterId: gamesPlan.cursor,
    });
    await finishSportWorkingCopy(sportDb, "games", gamesPlan, games);
    checkpoints.games = games.cursor;
    results.push({ table: "games", ok: true, ...games });
  } catch (error) {
    results.push({ table: "games", ok: false, copied: 0, error: String(error?.message || error).slice(0, 240) });
  }

  try {
    const predsPlan = await beginSportWorkingCopy(primary, sportDb, key, "prediction_snapshots", resume);
    const preds = await copyPredictionsPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterId: predsPlan.cursor,
    });
    await finishSportWorkingCopy(sportDb, "prediction_snapshots", predsPlan, preds);
    checkpoints.prediction_snapshots = preds.cursor;
    results.push({ table: "prediction_snapshots", ok: true, ...preds });
  } catch (error) {
    results.push({
      table: "prediction_snapshots",
      ok: false,
      copied: 0,
      error: String(error?.message || error).slice(0, 240),
    });
  }

  try {
    const publishedPlan = await beginSportWorkingCopy(primary, sportDb, key, "published_projections", resume);
    const pubs = await copyPublishedPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterKey: publishedPlan.cursor,
    });
    await finishSportWorkingCopy(sportDb, "published_projections", publishedPlan, pubs);
    checkpoints.published_projections = pubs.cursor;
    results.push({ table: "published_projections", ok: true, ...pubs });
  } catch (error) {
    results.push({
      table: "published_projections",
      ok: false,
      copied: 0,
      error: String(error?.message || error).slice(0, 240),
    });
  }

  await metaSet(sportDb, "last_copy_at", new Date().toISOString());

  const moreRemaining = results.some((r) => r.ok && r.exhausted === false);
  return {
    ok: results.every((r) => r.ok),
    sport: key,
    results,
    checkpoints,
    schemaHeals,
    moreRemaining,
    plan,
    productStillPrimary: true,
    canAuthorizeWager: false,
  };
}

/**
 * Reconcile projection counts + sample keyed field hashes between primary and sport.
 */
export async function reconcileSportProjections(env, sport, { sampleSize = 40 } = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, canAuthorizeWager: false };

  const predPrimary = await count(primary, "SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=?", key);
  const predSport = await count(sportDb, "SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=?", key);
  const pubPrimary = await count(primary, "SELECT COUNT(*) n FROM published_projections WHERE sport=?", key);
  const pubSport = await count(sportDb, "SELECT COUNT(*) n FROM published_projections WHERE sport=?", key);

  const limit = Math.min(200, Math.max(5, Number(sampleSize) || 40));
  const primaryPreds = (await primary.prepare(
    `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
     FROM prediction_snapshots WHERE sport=? ORDER BY frozen_at DESC LIMIT ?`
  ).bind(key, limit).all())?.results || [];

  let matched = 0;
  const mismatches = [];
  for (const p of primaryPreds) {
    const id = stablePredictionId(p);
    const s = await sportDb.prepare(
      `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
       FROM prediction_snapshots WHERE id=? LIMIT 1`
    ).bind(id).first();
    const numEq = (a, b) => {
      if (a == null && b == null) return true;
      const x = Number(a); const y = Number(b);
      return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
    };
    const equal = Boolean(s)
      && String(s.game_id || "") === String(p.game_id || "")
      && String(s.frozen_at || "") === String(p.frozen_at || "")
      && String(s.model_version || "") === String(p.model_version || "")
      && numEq(s.proj_total, p.proj_total)
      && numEq(s.proj_home, p.proj_home)
      && numEq(s.proj_away, p.proj_away)
      && numEq(s.p_home_final, p.p_home_final);
    if (equal) matched += 1;
    else mismatches.push({ id, status: s ? "DIVERGED" : "MISSING" });
  }

  // Evidence coverage: envelopes + weights beyond count parity.
  let withEnvelope = null;
  let withWeights = null;
  let fidelitySampled = 0;
  let fidelityOk = 0;
  try {
    withEnvelope = await count(
      sportDb,
      `SELECT COUNT(*) n FROM prediction_snapshots
       WHERE sport=? AND payload_json IS NOT NULL AND payload_json LIKE '%fbis-canonical-evidence-v1%'`,
      key
    );
    withWeights = await count(
      sportDb,
      `SELECT COUNT(*) n FROM prediction_snapshots
       WHERE sport=? AND weights_json IS NOT NULL AND TRIM(weights_json) != ''`,
      key
    );
    for (const p of primaryPreds.slice(0, Math.min(20, primaryPreds.length))) {
      const id = stablePredictionId(p);
      const s = await sportDb.prepare(
        `SELECT id,weights_json,layers_json,payload_json FROM prediction_snapshots WHERE id=? LIMIT 1`
      ).bind(id).first();
      fidelitySampled += 1;
      const fidelity = evaluateSportPredictionFidelity({
        ...p,
        id,
        sport: key,
        weights_json: s?.weights_json ?? null,
        layers_json: s?.layers_json ?? null,
        payload_json: s?.payload_json ?? null,
      });
      if (fidelity.ok) fidelityOk += 1;
      else mismatches.push({ id, status: "EVIDENCE_INCOMPLETE", missing: fidelity.missing.slice(0, 5) });
    }
  } catch {
    /* evidence probes are additive */
  }

  const countsOk = predPrimary === predSport && pubPrimary === pubSport;
  const sampleOk = primaryPreds.length === 0 || matched === primaryPreds.length;
  const evidenceOk = predSport == null
    || (withEnvelope != null && withEnvelope === predSport && fidelitySampled === fidelityOk);
  const status = countsOk && sampleOk && evidenceOk
    ? "PROJECTION_RECONCILE_OK"
    : "PROJECTION_RECONCILE_INCOMPLETE";

  return {
    ok: status === "PROJECTION_RECONCILE_OK",
    sport: key,
    status,
    counts: {
      prediction_snapshots: { primary: predPrimary, sport: predSport, status: predPrimary === predSport ? "PARITY" : "DIVERGED" },
      published_projections: { primary: pubPrimary, sport: pubSport, status: pubPrimary === pubSport ? "PARITY" : "DIVERGED" },
    },
    evidence: {
      withEnvelope,
      withWeights,
      coverageOk: evidenceOk,
      fidelitySampled,
      fidelityOk,
    },
    sample: { sampled: primaryPreds.length, matched, mismatches: mismatches.slice(0, 10) },
    productIoUsesSportDb: false,
    canAuthorizeWager: false,
  };
}

/**
 * Backfill evidence envelopes + typed evidence columns on an existing sport shard
 * from PRIMARY without changing product authority. Resumes via meta cursor.
 */
export async function backfillSportEvidenceEnvelopes(env, sport, {
  pageSize = 200,
  maxPages = 100,
  resume = true,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  if (!plan?.databaseId) return { ok: false, reason: "SPORT_DB_NOT_PROVISIONED", sport: key, canAuthorizeWager: false };
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, canAuthorizeWager: false };

  const product = productSportDbHandle(env, key);
  if (product.productIoUsesSportDb) {
    return {
      ok: false,
      reason: "REFUSED_WHILE_SPORT_MODE_ACTIVE",
      sport: key,
      canAuthorizeWager: false,
    };
  }

  const afterId = resume ? (await metaGet(sportDb, "evidence_backfill_cursor") || "") : "";
  const result = await copyPredictionsPaged(primary, sportDb, key, {
    pageSize: Math.min(500, Math.max(1, Number(pageSize) || 200)),
    maxPages: Math.min(500, Math.max(1, Number(maxPages) || 100)),
    afterId,
  });
  if (result.cursor) await metaSet(sportDb, "evidence_backfill_cursor", result.cursor);
  await metaSet(sportDb, "evidence_backfill_at", new Date().toISOString());

  let withEnvelope = null;
  let withWeights = null;
  try {
    withEnvelope = await count(
      sportDb,
      `SELECT COUNT(*) n FROM prediction_snapshots
       WHERE sport=? AND payload_json IS NOT NULL AND payload_json LIKE '%fbis-canonical-evidence-v1%'`
      , key
    );
    withWeights = await count(
      sportDb,
      `SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=? AND weights_json IS NOT NULL AND weights_json != ''`,
      key
    );
  } catch {
    /* optional probes */
  }

  return {
    ok: result.copied >= 0 && !result.error,
    sport: key,
    ...result,
    evidence: { withEnvelope, withWeights },
    moreRemaining: result.exhausted === false,
    productStillPrimary: true,
    canAuthorizeWager: false,
  };
}

/** Declared migration scope for a sport (working set + prefix tables). Props deferred. */
/** All sports eligible for shadow working-set + optional prefix sync. */
export const SPORT_SYNC_SPORTS = Object.freeze(Object.keys(SPORT_PREFIX_TABLES));

export function isSportSyncEligible(sport) {
  const key = String(sport || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SPORT_PREFIX_TABLES, key);
}

export function sportMigrationScope(sport) {
  const key = String(sport || "").toLowerCase();
  return {
    sport: key,
    workingTables: SPORT_WORKING_TABLES.map((t) => t.table),
    prefixTables: SPORT_PREFIX_TABLES[key] || [],
    syncEligible: isSportSyncEligible(key),
    deferredPlayerProps: true,
    productAuthority: "PRIMARY_UNTIL_CUTOVER_RECEIPT",
    cutoverAuthorized: false,
    canAuthorizeWager: false,
  };
}

function assertSafeIdent(name) {
  const n = String(name || "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`UNSAFE_IDENT:${n}`);
  return n;
}

function sqliteType(type) {
  const t = String(type || "TEXT").toUpperCase();
  if (t.includes("INT")) return "INTEGER";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "REAL";
  if (t.includes("BLOB")) return "BLOB";
  return "TEXT";
}

/**
 * Mirror a PRIMARY table's schema onto the sport DB.
 * Additive only — CREATE IF NOT EXISTS, then ALTER TABLE ADD COLUMN for drift.
 * Never drops, renames, or rewrites existing sport-side columns.
 */
export async function ensureMirroredSportTable(primary, sportDb, tableName) {
  const table = assertSafeIdent(tableName);
  const info = await primary.prepare(`PRAGMA table_info(${table})`).all();
  const cols = info?.results || [];
  if (!cols.length) return { ok: false, reason: "PRIMARY_TABLE_MISSING", table };
  const existing = await sportDb.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
  ).bind(table).first();
  const tableExists = existing?.ok === 1 || existing?.ok === true || Number(existing?.ok) === 1;
  if (!tableExists) {
    const pkCols = cols.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    const colSql = cols.map((c) => {
      const name = assertSafeIdent(c.name);
      const typ = sqliteType(c.type);
      // New tables may honor NOT NULL; additive ALTER columns must stay nullable.
      const notnull = Number(c.notnull) === 1 ? " NOT NULL" : "";
      return `${name} ${typ}${notnull}`;
    }).join(", ");
    const pkSql = pkCols.length
      ? `, PRIMARY KEY (${pkCols.map((c) => assertSafeIdent(c.name)).join(", ")})`
      : "";
    await sportDb.prepare(`CREATE TABLE IF NOT EXISTS ${table} (${colSql}${pkSql})`).run();
    return { ok: true, skipped: false, table, columns: cols.length, pk: pkCols.map((c) => c.name), addedColumns: [] };
  }

  const sportInfo = await sportDb.prepare(`PRAGMA table_info(${table})`).all();
  const sportCols = new Set((sportInfo?.results || []).map((c) => String(c.name)));
  const addedColumns = [];
  for (const c of cols) {
    const name = assertSafeIdent(c.name);
    if (sportCols.has(name)) continue;
    // Additive columns cannot carry NOT NULL without a default on existing rows.
    const typ = sqliteType(c.type);
    await sportDb.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${typ}`).run();
    addedColumns.push(name);
    sportCols.add(name);
  }
  return {
    ok: true,
    skipped: addedColumns.length === 0,
    healed: addedColumns.length > 0,
    table,
    columns: cols.length,
    addedColumns,
  };
}

/**
 * Build a stable keyset across every PRIMARY-key component, not just the first.
 * Single-column cursors retain their existing representation; composite
 * cursors are versioned JSON arrays so the next bounded run can resume within
 * a repeated first-key group. Legacy unversioned composite cursors restart at
 * the beginning once and are safely re-applied by the destination upsert.
 */
export function prefixCompositeCursorPlan(pkNames, afterKey = "") {
  const keys = (pkNames || []).map((x) => assertSafeIdent(x));
  if (!keys.length) throw new Error("PREFIX_KEYSET_REQUIRES_KEY");
  const composite = keys.length > 1;
  const raw = String(afterKey || "");
  let values = [];
  if (raw && composite && raw.startsWith("pkv2:")) {
    try {
      const parsed = JSON.parse(raw.slice(5));
      if (Array.isArray(parsed) && parsed.length === keys.length && parsed.every(v => v !== null && v !== undefined)) {
        values = parsed;
      }
    } catch { /* malformed cursor is replayed from start, never trusted */ }
  } else if (raw && !composite) {
    values = [raw];
  }
  const orderBy = keys.join(", ");
  const where = !values.length ? "" : composite
    ? `WHERE (${keys.join(", ")}) > (${keys.map(() => "?").join(", ")})`
    : `WHERE ${keys[0]}>?`;
  const encode = (row) => composite
    ? `pkv2:${JSON.stringify(keys.map(k => row[k]))}`
    : String(row[keys[0]] ?? "");
  return { keys, composite, values, orderBy, where, encode, legacyReset: composite && raw.length > 0 && !values.length };
}

/**
 * Copy rows for one prefix table using keyset on the full PRIMARY-key tuple (or rowid).
 */
export async function copyPrefixedTablePaged(primary, sportDb, tableName, {
  pageSize = 200,
  maxPages = 25,
  afterKey = "",
  leagueFilter = null,
} = {}) {
  const table = assertSafeIdent(tableName);
  // A cross-sport league filter is only valid for the shared Asian tables.
  const league = leagueFilter == null ? null : String(leagueFilter).toUpperCase();
  if (league !== null && (!table.startsWith("asian_baseball_") || !["KBO", "NPB"].includes(league))) {
    throw new Error("UNSAFE_ASIAN_BASEBALL_LEAGUE_FILTER");
  }
  const mirror = await ensureMirroredSportTable(primary, sportDb, table);
  if (!mirror.ok) return { table, ok: false, copied: 0, ...mirror };

  const info = await primary.prepare(`PRAGMA table_info(${table})`).all();
  const cols = (info?.results || []).map((c) => assertSafeIdent(c.name));
  const pkCols = (info?.results || []).filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
  const hasPrimaryKey = pkCols.length > 0;
  const keyNames = hasPrimaryKey ? pkCols.map(c => c.name) : ["rowid"];
  const selectCols = hasPrimaryKey ? cols : ["rowid AS __key", ...cols];
  // Legacy scalar cursor on a composite PK is not safe: rescan once.
  let cursor = prefixCompositeCursorPlan(keyNames, afterKey).legacyReset ? "" : afterKey;
  let copied = 0;
  let pages = 0;
  let lastKey = cursor;
  for (; pages < maxPages; pages += 1) {
    const plan = prefixCompositeCursorPlan(keyNames, cursor);
    const filterTerms = [];
    const filterArgs = [];
    if (league) {
      filterTerms.push("league=?");
      filterArgs.push(league);
    }
    if (plan.where) {
      filterTerms.push(plan.where.slice(6));
      filterArgs.push(...plan.values);
    }
    const where = filterTerms.length ? `WHERE ${filterTerms.join(" AND ")}` : "";
    const page = await primary.prepare(
      `SELECT ${selectCols.join(",")} FROM ${table} ${where} ORDER BY ${plan.orderBy} ASC LIMIT ?`
    ).bind(...filterArgs, pageSize).all();
    const rows = page?.results || [];
    if (!rows.length) break;
    const colList = cols.join(",");
    const placeholders = cols.map(() => "?").join(",");
    const insertSql = hasPrimaryKey
      ? `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`
      : `INSERT OR REPLACE INTO ${table} (rowid,${colList}) VALUES (?,${placeholders})`;
    const statement = sportDb.prepare(insertSql);
    const bound = rows.map(row => {
      const values = cols.map(c => row[c] ?? null);
      // Tables without a declared PK use source rowid as the stable identity.
      return hasPrimaryKey ? statement.bind(...values) : statement.bind(row.__key, ...values);
    });
    if (typeof sportDb.batch === "function") {
      // Cloudflare D1 executes each batch atomically. Forty statements per
      // call avoid thousands of sequential D1 round trips for NBA/NHL/CFB
      // research backfills while keeping write transactions bounded.
      for (let offset = 0; offset < bound.length; offset += 40) {
        await sportDb.batch(bound.slice(offset, offset + 40));
      }
    } else {
      // Explicit fallback for injected/testing database implementations.
      for (const stmt of bound) await stmt.run();
    }
    // Never persist cursor progress before the whole page succeeds.
    copied += rows.length;
    const final = rows[rows.length - 1];
    lastKey = plan.encode(hasPrimaryKey ? final : { rowid: final.__key });
    cursor = lastKey;
    if (rows.length < pageSize) break;
  }
  return {
    table,
    ok: true,
    copied,
    pages,
    cursor: lastKey,
    exhausted: pages < maxPages || copied === 0,
    mirror,
  };
}

/**
 * Count-level parity for declared sport-prefix research tables.
 * Distinguishes complete sport migration from working-set-only parity.
 */
export async function verifySportPrefixParity(env, sport, { now = new Date() } = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  const tables = SPORT_PREFIX_TABLES[key] || [];
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, canAuthorizeWager: false };

  const rows = [];
  let matched = 0;
  let incomplete = 0;
  let missing = 0;
  for (const table of tables) {
    const league = table.startsWith("asian_baseball_") && ["kbo", "npb"].includes(key)
      ? key.toUpperCase() : null;
    const countSql = `SELECT COUNT(*) n FROM ${assertSafeIdent(table)}${league ? " WHERE league=?" : ""}`;
    const primaryN = await count(primary, countSql, ...(league ? [league] : []));
    let sportN = null;
    let reason = null;
    try {
      sportN = await count(sportDb, countSql, ...(league ? [league] : []));
    } catch (error) {
      reason = String(error?.message || error).slice(0, 120);
    }
    if (primaryN == null) {
      rows.push({ table, primaryCount: null, sportCount: sportN, status: "PRIMARY_TABLE_MISSING" });
      missing += 1;
      continue;
    }
    if (sportN == null) {
      rows.push({ table, primaryCount: primaryN, sportCount: null, status: "SPORT_TABLE_MISSING", reason });
      missing += 1;
      continue;
    }
    const status = primaryN === sportN ? "PARITY" : "DIVERGED";
    if (status === "PARITY") matched += 1;
    else incomplete += 1;
    rows.push({
      table,
      primaryCount: primaryN,
      sportCount: sportN,
      delta: primaryN - sportN,
      status,
    });
  }

  const status = tables.length === 0
    ? "PREFIX_EMPTY_OK"
    : (matched === tables.length ? "PREFIX_PARITY_OK" : "PREFIX_PARITY_INCOMPLETE");

  return {
    ok: status === "PREFIX_PARITY_OK" || status === "PREFIX_EMPTY_OK",
    sport: key,
    status,
    checkedAt: now instanceof Date ? now.toISOString() : String(now),
    tableCount: tables.length,
    matchedTables: matched,
    incompleteTables: incomplete,
    missingTables: missing,
    tables: rows,
    productIoUsesSportDb: false,
    cutoverAuthorized: false,
    canAuthorizeWager: false,
  };
}

/**
 * Shadow-copy declared prefix tables for a sport. Never activates authority.
 * When skipCaughtUp is true, tables already at count parity are skipped so
 * remaining budget focuses on incomplete research/roster/model tables.
 */
export async function copySportPrefixTables(env, sport, {
  pageSize = 200,
  maxPages = 25,
  resume = true,
  tables = null,
  skipCaughtUp = false,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const plan = SPORT_DATABASES[key];
  const primary = env?.DB;
  const sportDb = plan?.binding ? env?.[plan.binding] : null;
  if (!plan?.databaseId) return { ok: false, reason: "SPORT_DB_NOT_PROVISIONED", sport: key, canAuthorizeWager: false };
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, canAuthorizeWager: false };

  const product = productSportDbHandle(env, key);
  if (product.productIoUsesSportDb) {
    return {
      ok: false,
      reason: "REFUSED_WHILE_SPORT_MODE_ACTIVE",
      sport: key,
      canAuthorizeWager: false,
    };
  }

  const allowed = new Set(SPORT_PREFIX_TABLES[key] || []);
  let wanted = (tables && Array.isArray(tables) ? tables : [...allowed])
    .map((t) => String(t))
    .filter((t) => allowed.has(t));

  const skipped = [];
  if (skipCaughtUp && wanted.length) {
    const next = [];
    for (const table of wanted) {
      const league = table.startsWith("asian_baseball_") && ["kbo", "npb"].includes(key)
        ? key.toUpperCase() : null;
      const countSql = `SELECT COUNT(*) n FROM ${assertSafeIdent(table)}${league ? " WHERE league=?" : ""}`;
      const primaryN = await count(primary, countSql, ...(league ? [league] : []));
      const sportN = await count(sportDb, countSql, ...(league ? [league] : []));
      const replayKey = `copy_replay_active_prefix_${table}`;
      const replayActive = resume && (await metaGet(sportDb, replayKey)) === "1";
      if (primaryN != null && sportN != null && primaryN === sportN && !replayActive) {
        skipped.push({ table, primaryCount: primaryN, sportCount: sportN, status: "SKIPPED_CAUGHT_UP" });
        continue;
      }
      // A newly discovered missing row may sort behind a saved cursor.
      // Start one full idempotent replay and record that it is in progress;
      // otherwise large research tables would rewind at *every* bounded pass
      // and never get beyond the first few pages.
      if (resume && primaryN != null && sportN != null && sportN < primaryN && !replayActive) {
        await metaSet(sportDb, `copy_cursor_prefix_${table}`, "");
        await metaSet(sportDb, replayKey, "1");
      }
      next.push(table);
    }
    wanted = next;
  }

  const results = [];
  for (const table of wanted) {
    try {
      const afterKey = resume ? (await metaGet(sportDb, `copy_cursor_prefix_${table}`) || "") : "";
      const copied = await copyPrefixedTablePaged(primary, sportDb, table, {
        pageSize: Math.min(500, Math.max(1, Number(pageSize) || 200)),
        maxPages: Math.min(100, Math.max(1, Number(maxPages) || 25)),
        afterKey,
        leagueFilter: table.startsWith("asian_baseball_") && ["kbo", "npb"].includes(key)
          ? key.toUpperCase() : null,
      });
      if (copied.cursor) await metaSet(sportDb, `copy_cursor_prefix_${table}`, copied.cursor);
      // Only stop replaying after the keyset scan reaches its end.
      if (copied.exhausted === true && (await metaGet(sportDb, `copy_replay_active_prefix_${table}`)) === "1") {
        await metaSet(sportDb, `copy_replay_active_prefix_${table}`, "0");
      }
      results.push(copied);
    } catch (error) {
      results.push({
        table,
        ok: false,
        copied: 0,
        error: String(error?.message || error).slice(0, 240),
      });
    }
  }
  await metaSet(sportDb, "last_prefix_copy_at", new Date().toISOString());
  return {
    ok: results.every((r) => r.ok),
    sport: key,
    results,
    skippedCaughtUp: skipped,
    moreRemaining: results.some((r) => r.ok && r.exhausted === false),
    productStillPrimary: true,
    canAuthorizeWager: false,
  };
}

/**
 * Continuous shadow sync: repeat working-set copy until exhausted (bounded rounds).
 * Also optionally runs one prefix-table pass. Never activates sport authority.
 */
export async function syncSportWorkingDelta(env, sport, {
  rounds = 5,
  pageSize = 1000,
  maxPages = 50,
  includePrefix = false,
} = {}) {
  const key = String(sport || "").toLowerCase();
  const roundsN = Math.min(20, Math.max(1, Number(rounds) || 5));
  const passes = [];
  let moreRemaining = true;
  for (let i = 0; i < roundsN && moreRemaining; i += 1) {
    const pass = await copySportWorkingTables(env, key, {
      pageSize,
      maxPages,
      resume: true,
    });
    passes.push({
      round: i + 1,
      ok: pass.ok,
      moreRemaining: pass.moreRemaining,
      results: (pass.results || []).map((r) => ({
        table: r.table,
        copied: r.copied,
        exhausted: r.exhausted,
        ok: r.ok,
      })),
      reason: pass.reason || null,
    });
    if (!pass.ok) {
      return {
        ok: false,
        sport: key,
        passes,
        caughtUp: false,
        reason: pass.reason || `WORKING_SET_COPY_FAILED:${(pass.results || []).filter(r => !r.ok).map(r => r.table).join(",")}`,
        productStillPrimary: true,
        canAuthorizeWager: false,
      };
    }
    moreRemaining = Boolean(pass.moreRemaining);
  }

  let prefix = null;
  if (includePrefix) {
    prefix = await copySportPrefixTables(env, key, { resume: true, pageSize: 200, maxPages: 25 });
  }

  const parity = await verifySportWorkingParity(env, key);
  return {
    ok: parity.ok && (!prefix || prefix.ok),
    sport: key,
    passes,
    // Exhausted cursors do not mean caught up when source rows remain missing.
    caughtUp: !moreRemaining && parity.ok === true,
    moreRemaining: moreRemaining || parity.ok !== true,
    prefix,
    parity,
    productStillPrimary: true,
    canAuthorizeWager: false,
  };
}

export async function verifySportWorkingParity(env, sport, { now = new Date() } = {}) {
  const key = String(sport || "").toLowerCase();
  const resolved = resolveSportDb(env, key, { mode: "shadow" });
  const primary = env?.DB;
  const sportDb = resolved.sportDb || (resolved.plan?.binding ? env?.[resolved.plan.binding] : null);
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", sport: key, canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "SPORT_DB_UNBOUND", sport: key, plan: resolved.plan, canAuthorizeWager: false };

  const tables = [];
  let matched = 0;
  for (const spec of SPORT_WORKING_TABLES) {
    const sql = `SELECT COUNT(*) n FROM ${spec.table} WHERE sport=?`;
    const primaryCount = await count(primary, sql, key);
    const sportCount = await count(sportDb, sql, key);
    const equal = primaryCount != null && sportCount != null && primaryCount === sportCount;
    if (equal) matched += 1;
    tables.push({
      table: spec.table,
      primaryCount,
      sportCount,
      status: primaryCount == null || sportCount == null ? "PROBE_FAILED" : equal ? "PARITY" : "DIVERGED",
    });
  }

  const status = matched === SPORT_WORKING_TABLES.length ? "PARITY_OK" : "PARITY_INCOMPLETE";
  const receipt = {
    receiptId: `${key}-parity-${now.toISOString().replace(/[:.]/g, "-")}`,
    checkedAt: now.toISOString(),
    sport: key,
    status,
    matchedTables: matched,
    tableCount: SPORT_WORKING_TABLES.length,
    tables,
    productIoUsesSportDb: false,
    plan: resolved.plan,
    canAuthorizeWager: false,
  };

  try {
    await sportDb.prepare(
      `INSERT OR REPLACE INTO sport_parity_receipts(receipt_id,checked_at,table_name,primary_count,sport_count,matched,status,detail_json)
       VALUES(?,?,?,?,?,?,?,?)`
    ).bind(
      receipt.receiptId,
      receipt.checkedAt,
      "ALL_WORKING_TABLES",
      tables.reduce((n, t) => n + (t.primaryCount || 0), 0),
      tables.reduce((n, t) => n + (t.sportCount || 0), 0),
      matched,
      status,
      JSON.stringify(tables)
    ).run();
  } catch {
    receipt.receiptPersist = "SPORT_PARITY_RECEIPT_WRITE_FAILED";
  }

  return { ok: status === "PARITY_OK", ...receipt };
}

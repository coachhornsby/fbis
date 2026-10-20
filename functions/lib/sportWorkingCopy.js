/**
 * Generic sport working-set copy + shadow validation.
 * Copies from PRIMARY into a sport D1 without changing product authority.
 * Never deletes primary rows. Never sets mode=sport.
 *
 * Pagination is deterministic keyset-by-id so repeated runs reach older rows
 * (CFB predictions exceed a single LIMIT page).
 */
import { resolveSportDb, SPORT_DATABASES, productSportDbHandle } from "./databaseTopology.js";
import {
  buildPredictionEvidenceEnvelope,
  evaluateSportPredictionFidelity,
} from "./canonicalEvidenceContract.js";

export const SPORT_WORKING_TABLES = Object.freeze([
  Object.freeze({ table: "games" }),
  Object.freeze({ table: "prediction_snapshots" }),
  Object.freeze({ table: "published_projections" }),
]);

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

  try {
    const afterGames = resume ? (await metaGet(sportDb, `copy_cursor_games`) || "") : "";
    const games = await copyGamesPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterId: afterGames,
    });
    if (games.cursor) await metaSet(sportDb, "copy_cursor_games", games.cursor);
    checkpoints.games = games.cursor;
    results.push({ table: "games", ok: true, ...games });
  } catch (error) {
    results.push({ table: "games", ok: false, copied: 0, error: String(error?.message || error).slice(0, 240) });
  }

  try {
    const afterPreds = resume ? (await metaGet(sportDb, `copy_cursor_prediction_snapshots`) || "") : "";
    const preds = await copyPredictionsPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterId: afterPreds,
    });
    if (preds.cursor) await metaSet(sportDb, "copy_cursor_prediction_snapshots", preds.cursor);
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
    const afterPub = resume ? (await metaGet(sportDb, `copy_cursor_published_projections`) || "") : "";
    const pubs = await copyPublishedPaged(primary, sportDb, key, {
      pageSize: effectivePageSize,
      maxPages: effectiveMaxPages,
      afterKey: afterPub,
    });
    if (pubs.cursor) await metaSet(sportDb, "copy_cursor_published_projections", pubs.cursor);
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

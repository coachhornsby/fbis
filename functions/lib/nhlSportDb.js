/**
 * NHL sport-D1 pilot: copy selected working rows from primary and verify read parity.
 * Primary remains authoritative until NHL_SPORT_DB_MODE=sport after parity passes.
 */
import { resolveSportDb, SPORT_DATABASES } from "./databaseTopology.js";

export const NHL_PILOT_TABLES = Object.freeze([
  Object.freeze({
    table: "games",
    primarySql: "SELECT COUNT(*) n FROM games WHERE sport='nhl'",
    sportSql: "SELECT COUNT(*) n FROM games WHERE sport='nhl'",
    copySql: `INSERT OR REPLACE INTO games(
      id,sport,start,status,home_name,away_name,home_abbr,away_abbr,home_id,away_id,season,week,venue,payload_json,updated_at
    ) SELECT id,'nhl',start,status,home_name,away_name,home_abbr,away_abbr,home_id,away_id,season,week,venue,NULL,NULL
      FROM games WHERE sport='nhl'`,
  }),
  Object.freeze({
    table: "prediction_snapshots",
    primarySql: "SELECT COUNT(*) n FROM prediction_snapshots WHERE sport='nhl'",
    sportSql: "SELECT COUNT(*) n FROM prediction_snapshots WHERE sport='nhl'",
    copySql: `INSERT OR REPLACE INTO prediction_snapshots(
      id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at,payload_json
    ) SELECT COALESCE(id, game_id||'|'||frozen_at),game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at,NULL
      FROM prediction_snapshots WHERE sport='nhl'`,
  }),
  Object.freeze({
    table: "published_projections",
    primarySql: "SELECT COUNT(*) n FROM published_projections WHERE sport='nhl'",
    sportSql: "SELECT COUNT(*) n FROM published_projections WHERE sport='nhl'",
    copySql: `INSERT OR REPLACE INTO published_projections(id,game_id,sport,published_at,payload_json)
      SELECT COALESCE(id, game_id||'|'||published_at),game_id,sport,published_at,payload_json
      FROM published_projections WHERE sport='nhl'`,
  }),
]);

async function count(db, sql) {
  if (!db?.prepare) return null;
  try {
    const stmt = db.prepare(sql);
    const row = typeof stmt.first === "function" ? await stmt.first() : await stmt.bind().first();
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

export async function verifyNhlSportDbParity(env, { now = new Date() } = {}) {
  const resolved = resolveSportDb(env, "nhl", { mode: "shadow" });
  const sportDb = resolved.sportDb || env?.NHL_DB;
  const primary = env?.DB;
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND" };
  if (!sportDb?.prepare) return { ok: false, reason: "NHL_DB_UNBOUND", plan: SPORT_DATABASES.nhl };

  const tables = [];
  let matched = 0;
  for (const spec of NHL_PILOT_TABLES) {
    const primaryCount = await count(primary, spec.primarySql);
    const sportCount = await count(sportDb, spec.sportSql);
    const equal = primaryCount != null && sportCount != null && primaryCount === sportCount;
    if (equal) matched += 1;
    tables.push({
      table: spec.table,
      primaryCount,
      sportCount,
      status: primaryCount == null || sportCount == null ? "PROBE_FAILED" : equal ? "PARITY" : "DIVERGED",
    });
  }

  const status = matched === NHL_PILOT_TABLES.length ? "PARITY_OK" : "PARITY_INCOMPLETE";
  const receipt = {
    receiptId: `nhl-parity-${now.toISOString().replace(/[:.]/g, "-")}`,
    checkedAt: now.toISOString(),
    status,
    matchedTables: matched,
    tableCount: NHL_PILOT_TABLES.length,
    tables,
    plan: SPORT_DATABASES.nhl,
    canAuthorizeWager: false,
  };

  try {
    await sportDb.prepare(
      `INSERT OR REPLACE INTO nhl_parity_receipts(receipt_id,checked_at,table_name,primary_count,sport_count,matched,status,detail_json)
       VALUES(?,?,?,?,?,?,?,?)`
    ).bind(
      receipt.receiptId,
      receipt.checkedAt,
      "ALL_PILOT_TABLES",
      tables.reduce((n, t) => n + (t.primaryCount || 0), 0),
      tables.reduce((n, t) => n + (t.sportCount || 0), 0),
      matched,
      status,
      JSON.stringify(tables)
    ).run();
  } catch {
    receipt.receiptPersist = "NHL_PARITY_RECEIPT_WRITE_FAILED";
  }

  return { ok: status === "PARITY_OK", ...receipt };
}

/**
 * Record-level NHL shadow validation beyond row counts.
 * Samples games (id/start/names) and prediction snapshots
 * (id/frozen_at/projection fields) for exact match vs primary.
 */
export async function verifyNhlRecordLevelParity(env, {
  sampleSize = 40,
  now = new Date(),
} = {}) {
  const primary = env?.DB;
  const sportDb = env?.NHL_DB;
  if (!primary?.prepare) return { ok: false, reason: "PRIMARY_UNBOUND", canAuthorizeWager: false };
  if (!sportDb?.prepare) return { ok: false, reason: "NHL_DB_UNBOUND", canAuthorizeWager: false };

  const limit = Math.min(200, Math.max(5, Number(sampleSize) || 40));
  const gameChecks = [];
  const predChecks = [];
  let gameMatched = 0;
  let predMatched = 0;

  const primaryGames = (await primary.prepare(
    `SELECT id,start,home_name,away_name,home_abbr,away_abbr
     FROM games WHERE sport='nhl' ORDER BY start DESC LIMIT ?`
  ).bind(limit).all())?.results || [];

  for (const g of primaryGames) {
    const s = await sportDb.prepare(
      `SELECT id,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE id=? LIMIT 1`
    ).bind(g.id).first();
    const equal = Boolean(s)
      && String(s.start || "") === String(g.start || "")
      && String(s.home_name || "") === String(g.home_name || "")
      && String(s.away_name || "") === String(g.away_name || "")
      && String(s.home_abbr || "") === String(g.home_abbr || "")
      && String(s.away_abbr || "") === String(g.away_abbr || "");
    if (equal) gameMatched += 1;
    gameChecks.push({
      id: g.id,
      status: !s ? "MISSING" : equal ? "MATCH" : "DIVERGED",
      primaryStart: g.start || null,
      sportStart: s?.start || null,
    });
  }

  const primaryPreds = (await primary.prepare(
    `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
     FROM prediction_snapshots WHERE sport='nhl' ORDER BY frozen_at DESC LIMIT ?`
  ).bind(limit).all())?.results || [];

  for (const p of primaryPreds) {
    const s = await sportDb.prepare(
      `SELECT id,game_id,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
       FROM prediction_snapshots WHERE id=? LIMIT 1`
    ).bind(p.id).first();
    const numEq = (a, b) => {
      if (a == null && b == null) return true;
      const x = Number(a); const y = Number(b);
      return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
    };
    const equal = Boolean(s)
      && String(s.game_id || "") === String(p.game_id || "")
      && String(s.frozen_at || "") === String(p.frozen_at || "")
      && String(s.model_version || "") === String(p.model_version || "")
      && String(s.projection_kind || "") === String(p.projection_kind || "")
      && numEq(s.proj_total, p.proj_total)
      && numEq(s.proj_home, p.proj_home)
      && numEq(s.proj_away, p.proj_away)
      && numEq(s.p_home_final, p.p_home_final);
    if (equal) predMatched += 1;
    predChecks.push({
      id: p.id,
      status: !s ? "MISSING" : equal ? "MATCH" : "DIVERGED",
      primaryFrozenAt: p.frozen_at || null,
      sportFrozenAt: s?.frozen_at || null,
      primaryPHome: p.p_home_final ?? null,
      sportPHome: s?.p_home_final ?? null,
    });
  }

  const gamesOk = gameChecks.length > 0 && gameMatched === gameChecks.length;
  const predsOk = predChecks.length === 0 || predMatched === predChecks.length;
  const status = gamesOk && predsOk ? "RECORD_PARITY_OK" : "RECORD_PARITY_INCOMPLETE";
  const receipt = {
    receiptId: `nhl-record-parity-${now.toISOString().replace(/[:.]/g, "-")}`,
    checkedAt: now.toISOString(),
    status,
    sampleSize: limit,
    games: { sampled: gameChecks.length, matched: gameMatched, status: gamesOk ? "PARITY" : "DIVERGED" },
    predictions: { sampled: predChecks.length, matched: predMatched, status: predsOk ? "PARITY" : "DIVERGED" },
    gameSample: gameChecks.filter((c) => c.status !== "MATCH").slice(0, 10),
    predictionSample: predChecks.filter((c) => c.status !== "MATCH").slice(0, 10),
    productIoUsesSportDb: false,
    canAuthorizeWager: false,
  };

  try {
    await sportDb.prepare(
      `INSERT OR REPLACE INTO nhl_parity_receipts(receipt_id,checked_at,table_name,primary_count,sport_count,matched,status,detail_json)
       VALUES(?,?,?,?,?,?,?,?)`
    ).bind(
      receipt.receiptId,
      receipt.checkedAt,
      "RECORD_LEVEL_SAMPLE",
      gameChecks.length + predChecks.length,
      gameMatched + predMatched,
      gameMatched + predMatched,
      status,
      JSON.stringify({ games: receipt.games, predictions: receipt.predictions })
    ).run();
  } catch {
    receipt.receiptPersist = "NHL_RECORD_PARITY_RECEIPT_WRITE_FAILED";
  }

  return { ok: status === "RECORD_PARITY_OK", ...receipt };
}

/**
 * Copy NHL working rows from primary into NHL_DB.
 * Uses SELECT from primary then INSERT on sport DB (no cross-D1 SQL).
 * Callers must harvest-authorize; this never deletes primary rows.
 */
export async function copyNhlPilotTables(env, { limitPerTable = 5000 } = {}) {
  const primary = env?.DB;
  const sportDb = env?.NHL_DB;
  if (!primary?.prepare || !sportDb?.prepare) {
    return { ok: false, reason: !sportDb?.prepare ? "NHL_DB_UNBOUND" : "PRIMARY_UNBOUND" };
  }

  const results = [];
  for (const spec of NHL_PILOT_TABLES) {
    let copied = 0;
    try {
      if (spec.table === "games") {
        // Primary games schema is lean (id/sport/date/start/names/abbrs/updated_at).
        const page = await primary.prepare(
          `SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr
           FROM games WHERE sport='nhl' ORDER BY start DESC LIMIT ?`
        ).bind(limitPerTable).all();
        for (const row of page.results || []) {
          await sportDb.prepare(
            `INSERT OR REPLACE INTO games(id,sport,start,status,home_name,away_name,home_abbr,away_abbr,home_id,away_id,season,week,venue,payload_json,updated_at)
             VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,datetime('now'))`
          ).bind(
            row.id, "nhl", row.start, null, row.home_name, row.away_name, row.home_abbr, row.away_abbr
          ).run();
          copied += 1;
        }
      } else if (spec.table === "prediction_snapshots") {
        const page = await primary.prepare(
          `SELECT id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
           FROM prediction_snapshots WHERE sport='nhl' ORDER BY frozen_at DESC LIMIT ?`
        ).bind(limitPerTable).all();
        for (const row of page.results || []) {
          const id = row.id || `${row.game_id}|${row.frozen_at}|${row.model_version || ""}|${row.projection_kind || ""}`;
          await sportDb.prepare(
            `INSERT OR REPLACE INTO prediction_snapshots(id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at,payload_json)
             VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`
          ).bind(
            id, row.game_id, row.sport, row.model_version, row.projection_kind,
            row.proj_total, row.proj_home, row.proj_away, row.p_home_final, row.frozen_at
          ).run();
          copied += 1;
        }
      } else if (spec.table === "published_projections") {
        const page = await primary.prepare(
          `SELECT game_id,sport,published_at,payload_json
           FROM published_projections WHERE sport='nhl' ORDER BY published_at DESC LIMIT ?`
        ).bind(limitPerTable).all();
        for (const row of page.results || []) {
          const id = `${row.game_id}|${row.published_at}`;
          await sportDb.prepare(
            `INSERT OR REPLACE INTO published_projections(id,game_id,sport,published_at,payload_json)
             VALUES(?,?,?,?,?)`
          ).bind(id, row.game_id, row.sport, row.published_at, row.payload_json).run();
          copied += 1;
        }
      }
      results.push({ table: spec.table, ok: true, copied });
    } catch (error) {
      results.push({ table: spec.table, ok: false, copied, error: String(error?.message || error).slice(0, 240) });
    }
  }

  await sportDb.prepare(
    `INSERT OR REPLACE INTO fbis_sport_shard_meta(key,value_text,updated_at) VALUES('last_copy_at',?,datetime('now'))`
  ).bind(new Date().toISOString()).run().catch(() => {});

  return {
    ok: results.every((r) => r.ok),
    results,
    plan: SPORT_DATABASES.nhl,
    canAuthorizeWager: false,
  };
}

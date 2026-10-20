/**
 * Generic sport working-set copy + shadow validation.
 * Copies from PRIMARY into a sport D1 without changing product authority.
 * Never deletes primary rows. Never sets mode=sport.
 */
import { resolveSportDb, SPORT_DATABASES, productSportDbHandle } from "./databaseTopology.js";

export const SPORT_WORKING_TABLES = Object.freeze([
  Object.freeze({ table: "games" }),
  Object.freeze({ table: "prediction_snapshots" }),
  Object.freeze({ table: "published_projections" }),
]);

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

export async function copySportWorkingTables(env, sport, { limitPerTable = 5000 } = {}) {
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

  const results = [];
  for (const spec of SPORT_WORKING_TABLES) {
    let copied = 0;
    try {
      if (spec.table === "games") {
        const page = await primary.prepare(
          `SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr
           FROM games WHERE sport=? ORDER BY start DESC LIMIT ?`
        ).bind(key, limitPerTable).all();
        for (const row of page.results || []) {
          await sportDb.prepare(
            `INSERT OR REPLACE INTO games(id,sport,start,status,home_name,away_name,home_abbr,away_abbr,home_id,away_id,season,week,venue,payload_json,updated_at)
             VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,datetime('now'))`
          ).bind(row.id, key, row.start, null, row.home_name, row.away_name, row.home_abbr, row.away_abbr).run();
          copied += 1;
        }
      } else if (spec.table === "prediction_snapshots") {
        const page = await primary.prepare(
          `SELECT id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,p_home_final,frozen_at
           FROM prediction_snapshots WHERE sport=? ORDER BY frozen_at DESC LIMIT ?`
        ).bind(key, limitPerTable).all();
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
           FROM published_projections WHERE sport=? ORDER BY published_at DESC LIMIT ?`
        ).bind(key, limitPerTable).all();
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
    sport: key,
    results,
    plan,
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

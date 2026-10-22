/**
 * NHL sport-shard read cutover.
 *
 * fbis-nhl is a read replica of the NHL rows on primary. It becomes the source
 * for one read — the durable TODAY fallback when the request is NHL-only — and
 * only after a receipt says the projection columns matched primary exactly.
 * Every other read stays on primary. The gate cannot grant qualification or
 * wager authority, and a failed shard read falls back to primary in the caller.
 */

import { deployedSportDbMode, productSportDbHandle } from "./databaseTopology.js";

export const NHL_SHARD_DATABASE_ID = "a0aa010c-40d3-4d2f-8109-eca4e74e2a73";
export const NHL_DURABLE_RECEIPT_TABLE = "DURABLE_READ_COLUMNS";
export const NHL_PROJECTION_FIELDS = Object.freeze([
  "proj_home",
  "proj_away",
  "proj_total",
  "p_home_final",
]);

const fmt = (value) => (value == null ? "" : typeof value === "number" ? value.toFixed(6) : String(value));

/**
 * Full-key projection parity. A count match is not enough: every snapshot id
 * must be on both sides and the projection fields must be identical. Actual
 * results are compared too, so a cutover cannot serve a different grade.
 */
export function snapshotProjectionParity(primaryRows = [], shardRows = []) {
  const primary = new Map(primaryRows.map((row) => [row.id, row]));
  const fields = [...NHL_PROJECTION_FIELDS, "checkpoint", "date", "engine", "actual_home", "actual_away"];
  let matched = 0;
  const diverged = [];
  for (const shard of shardRows) {
    const source = primary.get(shard.id);
    if (!source) {
      diverged.push({ id: shard.id, reason: "MISSING_ON_PRIMARY" });
      continue;
    }
    const bad = fields.filter((field) => fmt(source[field]) !== fmt(shard[field]));
    if (bad.length) diverged.push({ id: shard.id, reason: "FIELD_MISMATCH", fields: bad });
    else matched += 1;
  }
  const shardIds = new Set(shardRows.map((row) => row.id));
  const missingOnShard = [...primary.keys()].filter((id) => !shardIds.has(id));
  return {
    ok: diverged.length === 0 && missingOnShard.length === 0 && primaryRows.length === shardRows.length,
    primary: primaryRows.length,
    shard: shardRows.length,
    matched,
    diverged,
    missingOnShard,
  };
}

/**
 * Decide which database serves the NHL durable read. Primary is the default.
 * The shard is used only when the binding exists, the latest receipt was armed
 * from a passing projection parity check, and that receipt did not change
 * betting permissions.
 */
export function cutoverGate({ bindingPresent = false, receipt = null, projectionParity = null } = {}) {
  const refused = (reason) => ({
    database: "PRIMARY",
    liveReadsRerouted: false,
    reason,
    canQualify: false,
    canAuthorizeWager: false,
  });
  if (!bindingPresent) return refused("NHL_DB_UNBOUND");
  if (!projectionParity?.ok) return refused("PROJECTION_PARITY_FAILED");
  if (receipt?.status !== "CUTOVER_READY") return refused("CUTOVER_NOT_ARMED");
  if (receipt.permissionsChanged === true) return refused("PERMISSION_CHANGE_BLOCKED");
  if (receipt.projectionFieldsRewritten === true) return refused("PROJECTION_REWRITE_BLOCKED");
  return {
    database: "NHL_DB",
    liveReadsRerouted: true,
    reason: "NHL_DURABLE_READ_CUTOVER",
    scope: "durable_today_when_sport_is_nhl",
    canQualify: false,
    canAuthorizeWager: false,
  };
}

export async function nhlDurableDatabase(env = {}) {
  // The legacy pilot receipt is not a production cutover grant.
  // Once mode=sport, honor the same strict CORE authority as every product reader.
  // Never silently recover from NHL D1 failure by reading stale PRIMARY.
  if (deployedSportDbMode(env, "nhl") === "sport") {
    const handle = productSportDbHandle(env, "nhl");
    return {
      database: handle.productIoUsesSportDb ? "NHL_DB" : "UNAVAILABLE",
      db: handle.productIoUsesSportDb ? handle.db : null,
      liveReadsRerouted: handle.productIoUsesSportDb === true,
      reason: handle.reason,
      canQualify: false,
      canAuthorizeWager: false,
    };
  }
  if (!env.NHL_DB?.prepare) {
    return { ...cutoverGate({ bindingPresent: false }), db: env.DB || null };
  }
  let receipt = null;
  try {
    const row = await env.NHL_DB.prepare(
      "SELECT status, detail_json FROM nhl_parity_receipts WHERE table_name = ? ORDER BY checked_at DESC LIMIT 1",
    ).bind(NHL_DURABLE_RECEIPT_TABLE).first();
    const detail = row?.detail_json ? JSON.parse(row.detail_json) : {};
    receipt = row ? { status: row.status, ...detail } : null;
  } catch {
    receipt = null;
  }
  const decision = cutoverGate({
    bindingPresent: true,
    receipt,
    projectionParity: receipt?.projectionParityOk === true ? { ok: true } : { ok: false },
  });
  return { ...decision, db: decision.database === "NHL_DB" ? env.NHL_DB : env.DB };
}

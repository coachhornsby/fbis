import { deployedSportDbMode, productSportDbHandle } from "./databaseTopology.js";

/** CBB research only. Never rebind shared wagering, telemetry, or props owners. */
export async function cbbResearchOwner(env = {}) {
  if (deployedSportDbMode(env, "cbb") !== "sport") {
    if (!env.DB?.prepare) throw new Error("CBB_PRIMARY_UNBOUND");
    return { db: env.DB, binding: "DB", canAuthorizeWager: false };
  }
  // Do not let a missing strict flag turn activation failures into PRIMARY reads.
  if (!env.CBB_DB?.prepare || env.CBB_DB === env.DB)
    throw new Error("CBB_SPORT_BINDING_REQUIRED");
  if (!["true", "1", "yes"].includes(String(env.SPORT_DB_STRICT_CBB).toLowerCase())
      || !["true", "1", "yes"].includes(String(env.SPORT_DB_LEDGER_READY_CBB).toLowerCase()))
    throw new Error("CBB_STRICT_LEDGER_CONTROLS_REQUIRED");
  if (!env.CORE_DB?.prepare) throw new Error("CBB_CORE_BINDING_REQUIRED");
  // Fresh request-local map: an earlier request's APPROVED cache cannot survive
  // revocation, a failed CORE read, or a reconstructed collector environment.
  const local = { ...env, __fbisCutoverApprovals: new Map() };
  const receipt = String(env.SPORT_CUTOVER_RECEIPT_CBB || "").trim();
  if (!receipt) throw new Error("CBB_CUTOVER_APPROVAL_REQUIRED");
  let row;
  try {
    row = await env.CORE_DB.prepare(`SELECT receipt_id,sport,status,approved_at,expires_at,revoked_at
      FROM fbis_sport_cutover_approvals WHERE sport=? AND receipt_id=? LIMIT 1`)
      .bind("cbb", receipt).first();
  } catch { throw new Error("CBB_CORE_APPROVAL_UNAVAILABLE"); }
  if (!row || row.sport !== "cbb" || row.receipt_id !== receipt
      || row.status !== "APPROVED" || row.revoked_at
      || (row.expires_at && (!Number.isFinite(Date.parse(row.expires_at))
        || Date.parse(row.expires_at) <= Date.now())))
    throw new Error("CBB_CUTOVER_APPROVAL_REQUIRED");
  local.__fbisCutoverApprovals.set(`cbb:${receipt}`, row);
  const owner = productSportDbHandle(local, "cbb");
  if (!owner.productIoUsesSportDb || owner.db !== env.CBB_DB)
    throw new Error("CBB_CUTOVER_APPROVAL_REQUIRED");
  return owner;
}

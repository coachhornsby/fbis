import { productSportDbHandle, deployedSportDbMode } from "./databaseTopology.js";

/**
 * Route NFL ledger tables through the approved dedicated D1.
 * A deployed sport mode with missing approval is an ERROR, not a silent
 * write back to PRIMARY (which would create split-brain after cutover).
 * Shared and non-NFL records retain PRIMARY.
 */
export function nflLedgerEnv(env, sport) {
  if (String(sport || "").toLowerCase() !== "nfl") return env;
  const mode = deployedSportDbMode(env, "nfl");
  if (mode !== "sport") return env;
  const handle = productSportDbHandle(env, "nfl");
  if (!handle.productIoUsesSportDb || !handle.db?.prepare) {
    return { ...env, DB: null, __nflLedgerRoutingError: handle.reason || "NFL_D1_AUTHORITY_UNAVAILABLE" };
  }
  return { ...env, DB: handle.db, __nflLedgerBinding: handle.binding };
}

/** Whether the cross-sport ledger needs a PRIMARY + NFL D1 read merge. */
export function nflLedgerFanoutDb(env) {
  if (deployedSportDbMode(env, "nfl") !== "sport") return null;
  const h = productSportDbHandle(env, "nfl");
  if (!h.productIoUsesSportDb || !h.db?.prepare) {
    throw new Error(h.reason || "NFL_D1_AUTHORITY_UNAVAILABLE");
  }
  return h.db;
}

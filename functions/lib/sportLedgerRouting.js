import { SPORT_DATABASES, productSportDbHandle, deployedSportDbMode } from "./databaseTopology.js";
import { nflLedgerEnv } from "./nflLedgerRouting.js";

/**
 * Sports only move shared-ledger reads/writes after individual schema, data,
 * consumer, and rollback qualification. Strict CORE-approved sport mode alone
 * does not imply that legacy predictions/odds/team-form tables are migrated.
 */
function ledgerReady(env, sport) {
  if (sport === "nfl") return true; // independently qualified in NFL v1 cutover
  return ["1", "true", "yes"].includes(
    String(env?.[`SPORT_DB_LEDGER_READY_${sport.toUpperCase()}`] || "").toLowerCase()
  );
}

export function sportLedgerEnv(env, sport) {
  const key = String(sport || "").toLowerCase();
  const marker = env?.__sportLedgerBinding;
  const primary = marker ? env.__sportLedgerPrimaryDb : env?.DB;
  if (marker && (!primary?.prepare || !Object.values(SPORT_DATABASES).some(p => p.binding === marker) || env.DB !== env[marker])) {
    return {...env, DB:null, __sportLedgerRoutingError:"SPORT_LEDGER_CONTEXT_MISMATCH"};
  }
  // Nested readback/grading revalidates against the original PRIMARY handle,
  // not the dedicated handle that the first routing call placed in DB.
  if (marker) {
    const {__sportLedgerBinding, __sportLedgerPrimaryDb, ...scope} = env;
    env = {...scope, DB:primary};
  }
  if (key === "nfl") {
    const routed = nflLedgerEnv(env, sport);
    return routed.DB?.prepare && routed.DB !== primary
      ? {...routed, __sportLedgerPrimaryDb:primary, __sportLedgerBinding:"NFL_DB"}
      : routed;
  }
  if (!SPORT_DATABASES[key] || deployedSportDbMode(env, key) !== "sport") return env;
  if (!ledgerReady(env, key)) {
    return { ...env, DB: null, __sportLedgerRoutingError: "SPORT_LEDGER_NOT_QUALIFIED" };
  }
  const routed = productSportDbHandle(env, key);
  if (!routed.productIoUsesSportDb || !routed.db?.prepare) {
    return { ...env, DB: null, __sportLedgerRoutingError: routed.reason || "SPORT_AUTHORITY_UNAVAILABLE" };
  }
  return { ...env, DB: routed.db, __sportLedgerPrimaryDb: primary, __sportLedgerBinding: routed.binding };
}

export function sportLedgerFanoutDbs(env) {
  const authorized = [];
  for (const sport of Object.keys(SPORT_DATABASES)) {
    if (deployedSportDbMode(env, sport) !== "sport") continue;
    if (!ledgerReady(env, sport)) throw new Error("SPORT_LEDGER_NOT_QUALIFIED:" + sport);
    const routed = productSportDbHandle(env, sport);
    if (!routed.productIoUsesSportDb || !routed.db?.prepare) {
      throw new Error("SPORT_AUTHORITY_UNAVAILABLE:" + sport);
    }
    authorized.push({ sport, db: routed.db });
  }
  return authorized;
}

/**
 * Request-scoped NBA-owned research read authority.
 * PRIMARY stays authoritative in shadow/primary mode; sport-mode readers
 * require an existing CORE APPROVED receipt and matching NBA_DB binding.
 *
 * Fail closed instead of silently using PRIMARY after a sport-mode switch.
 * Neither this resolver nor its consumers grant wagering or write permission.
 */
import {
  deployedSportDbMode,
  hydrateCutoverApprovals,
  productSportDbHandle,
} from "./databaseTopology.js";

export async function resolveNbaResearchOwnerDb(env = {}) {
  const mode = deployedSportDbMode(env, "nba");
  if (mode !== "sport") {
    const db = env?.DB?.prepare ? env.DB : null;
    return {
      ok: Boolean(db),
      db,
      env,
      binding: db ? "DB" : "UNAVAILABLE",
      mode,
      reason: db ? "NBA_PRIMARY_AUTHORITY" : "NBA_PRIMARY_UNBOUND",
      canAuthorizeWager: false,
    };
  }
  // Do not rely on a previously hydrated/injected approval map. Reload the
  // current production CORE decision for this request, including revocations.
  const scoped = { ...env, __fbisCutoverApprovals: new Map() };
  const hydrated = await hydrateCutoverApprovals(scoped, { sport: "nba" });
  if (!hydrated.ok) {
    return { ok: false, db: null, env: scoped, mode,
      reason: hydrated.reason || "NBA_CORE_APPROVAL_UNAVAILABLE", canAuthorizeWager: false };
  }
  const selected = productSportDbHandle(scoped, "nba");
  if (!selected.productIoUsesSportDb || selected.binding !== "NBA_DB" ||
      selected.db !== scoped.NBA_DB || !selected.db?.prepare) {
    return { ok: false, db: null, env: scoped, mode,
      reason: selected.reason || "NBA_SPORT_OWNER_NOT_APPROVED", canAuthorizeWager: false };
  }
  return {
    ok: true, db: selected.db, env: scoped, mode,
    binding: "NBA_DB", reason: "NBA_CORE_APPROVED_AUTHORITY",
    canAuthorizeWager: false,
  };
}

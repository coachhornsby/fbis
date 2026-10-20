/**
 * Production binding + shadow-mode integrity gate.
 * Declares the D1/env surface that must persist across Pages and stream deploys.
 * Does not authorize sport cutover.
 */
import { SPORT_DATABASES, CORE_DATABASE, MARKET_HISTORY_PARTITIONS } from "./databaseTopology.js";
import { DATABASE_OWNERS } from "./databaseOwnership.js";

export const TOPOLOGY_BINDING_GATE_CONTRACT = "fbis-topology-binding-gate-v1";

/** Required D1 bindings for Pages Functions (product surface). */
export const REQUIRED_PAGES_D1_BINDINGS = Object.freeze([
  Object.freeze({ binding: "DB", databaseId: DATABASE_OWNERS.PRIMARY.databaseId, role: "primary_authority" }),
  Object.freeze({ binding: CORE_DATABASE.binding, databaseId: CORE_DATABASE.databaseId, role: "core" }),
  Object.freeze({ binding: "OPERATIONS_DB", databaseId: DATABASE_OWNERS.OPERATIONS.databaseId, role: "operations" }),
  Object.freeze({ binding: "MARKET_HISTORY_DB", databaseId: DATABASE_OWNERS.MARKET_HISTORY.databaseId, role: "market_history_legacy" }),
  Object.freeze({
    binding: MARKET_HISTORY_PARTITIONS[0].binding,
    databaseId: MARKET_HISTORY_PARTITIONS[0].databaseId,
    role: "market_history_active_partition",
  }),
  Object.freeze({ binding: "COLD_HISTORY_DB", databaseId: DATABASE_OWNERS.COLD_HISTORY.databaseId, role: "cold_history" }),
  ...Object.values(SPORT_DATABASES).map((plan) => Object.freeze({
    binding: plan.binding,
    databaseId: plan.databaseId,
    role: `sport_${plan.sport}`,
  })),
]);

/** Required D1 bindings for the polymarket stream Worker. */
export const REQUIRED_STREAM_D1_BINDINGS = Object.freeze([
  Object.freeze({ binding: "DB", databaseId: DATABASE_OWNERS.PRIMARY.databaseId }),
  Object.freeze({ binding: "MARKET_HISTORY_DB", databaseId: DATABASE_OWNERS.MARKET_HISTORY.databaseId }),
  Object.freeze({
    binding: MARKET_HISTORY_PARTITIONS[0].binding,
    databaseId: MARKET_HISTORY_PARTITIONS[0].databaseId,
  }),
]);

/** All sport mode env vars must remain shadow until explicit cutover authorization. */
export function requiredSportModeVars() {
  const out = [
    { key: "NHL_SPORT_DB_MODE", expected: "shadow" },
  ];
  for (const sport of Object.keys(SPORT_DATABASES)) {
    out.push({ key: `SPORT_DB_MODE_${sport.toUpperCase()}`, expected: "shadow" });
  }
  return Object.freeze(out);
}

/**
 * Evaluate whether an env-like object has the required topology surface.
 * `bound` = binding present with prepare(); modes checked as string vars.
 */
export function evaluateTopologyBindingGate(env, {
  surface = "pages",
  requireShadowModes = true,
} = {}) {
  const required = surface === "stream" ? REQUIRED_STREAM_D1_BINDINGS : REQUIRED_PAGES_D1_BINDINGS;
  const missing = [];
  const present = [];
  for (const spec of required) {
    const db = env?.[spec.binding];
    if (db?.prepare) {
      present.push(spec.binding);
    } else {
      missing.push(spec.binding);
    }
  }

  const modeFailures = [];
  const modeOk = [];
  if (requireShadowModes && surface === "pages") {
    for (const spec of requiredSportModeVars()) {
      const value = String(env?.[spec.key] || "").toLowerCase();
      if (value !== spec.expected) {
        modeFailures.push({ key: spec.key, expected: spec.expected, actual: value || null });
      } else {
        modeOk.push(spec.key);
      }
    }
  }

  const anySportAuthoritative = Object.keys(SPORT_DATABASES).some((sport) => {
    const mode = String(
      env?.[`SPORT_DB_MODE_${sport.toUpperCase()}`]
      || (sport === "nhl" ? env?.NHL_SPORT_DB_MODE : "")
      || ""
    ).toLowerCase();
    return mode === "sport";
  });

  const ok = missing.length === 0 && modeFailures.length === 0 && !anySportAuthoritative;
  return {
    contract: TOPOLOGY_BINDING_GATE_CONTRACT,
    ok,
    surface,
    missing,
    present,
    modeFailures,
    modeOk,
    anySportAuthoritative,
    productionCutoverBlocked: true,
    canAuthorizeWager: false,
    note: ok
      ? "Topology bindings and shadow modes present."
      : "Binding/mode gate failed — restore before treating deploy as topology-ready.",
  };
}

/** Manifest used by operators / CI to restore dashboard project configs. */
export function topologyBindingRestorePlan() {
  const d1 = {};
  for (const spec of REQUIRED_PAGES_D1_BINDINGS) {
    d1[spec.binding] = { id: spec.databaseId };
  }
  const env_vars = {};
  for (const spec of requiredSportModeVars()) {
    env_vars[spec.key] = { type: "plain_text", value: spec.expected };
  }
  // Keep legacy NHL alias alongside SPORT_DB_MODE_NHL for older deploys.
  env_vars.NHL_SPORT_DB_MODE = { type: "plain_text", value: "shadow" };
  const streamD1 = {};
  for (const spec of REQUIRED_STREAM_D1_BINDINGS) {
    streamD1[spec.binding] = { id: spec.databaseId };
  }
  return {
    contract: TOPOLOGY_BINDING_GATE_CONTRACT,
    pages: {
      deployment_configs: {
        production: { d1_databases: d1, env_vars },
        preview: { d1_databases: d1, env_vars },
      },
    },
    stream: { d1_databases: streamD1 },
    canAuthorizeWager: false,
  };
}

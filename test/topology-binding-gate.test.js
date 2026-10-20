import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTopologyBindingGate,
  topologyBindingRestorePlan,
  REQUIRED_PAGES_D1_BINDINGS,
  REQUIRED_STREAM_D1_BINDINGS,
} from "../functions/lib/topologyBindingGate.js";

function prepareDb() {
  return { prepare() { return {}; } };
}

test("pages binding gate fails when CORE/sport/Q4 missing", () => {
  const env = {
    DB: prepareDb(),
    MARKET_HISTORY_DB: prepareDb(),
    OPERATIONS_DB: prepareDb(),
    COLD_HISTORY_DB: prepareDb(),
    TIER3_DB: prepareDb(),
  };
  const gate = evaluateTopologyBindingGate(env, { surface: "pages" });
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes("CORE_DB"));
  assert.ok(gate.missing.includes("NFL_DB"));
  assert.ok(gate.missing.includes("MARKET_HISTORY_2026Q4_DB"));
});

test("pages binding gate passes with full topology and shadow modes", () => {
  const env = { DB: prepareDb() };
  for (const spec of REQUIRED_PAGES_D1_BINDINGS) {
    env[spec.binding] = prepareDb();
  }
  env.NHL_SPORT_DB_MODE = "shadow";
  for (const sport of ["nhl", "nfl", "cfb", "cbb", "nba", "wnba", "mlb", "soccer", "tennis", "npb", "kbo"]) {
    env[`SPORT_DB_MODE_${sport.toUpperCase()}`] = "shadow";
  }
  const gate = evaluateTopologyBindingGate(env, { surface: "pages" });
  assert.equal(gate.ok, true);
  assert.equal(gate.missing.length, 0);
  assert.equal(gate.anySportAuthoritative, false);
});

test("stream binding gate requires Q4", () => {
  const env = {
    DB: prepareDb(),
    MARKET_HISTORY_DB: prepareDb(),
  };
  const gate = evaluateTopologyBindingGate(env, { surface: "stream", requireShadowModes: false });
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes("MARKET_HISTORY_2026Q4_DB"));

  env.MARKET_HISTORY_2026Q4_DB = prepareDb();
  const ok = evaluateTopologyBindingGate(env, { surface: "stream", requireShadowModes: false });
  assert.equal(ok.ok, true);
  assert.equal(REQUIRED_STREAM_D1_BINDINGS.length, 3);
});

test("restore plan lists all required pages D1 ids and shadow modes", () => {
  const plan = topologyBindingRestorePlan();
  assert.equal(REQUIRED_PAGES_D1_BINDINGS.length, 18);
  assert.ok(plan.pages.deployment_configs.production.d1_databases.CORE_DB);
  assert.ok(plan.pages.deployment_configs.production.d1_databases.NFL_DB);
  assert.ok(plan.pages.deployment_configs.production.d1_databases.TIER3_DB);
  assert.ok(plan.pages.deployment_configs.production.d1_databases.MARKET_HISTORY_2026Q4_DB);
  assert.equal(plan.pages.deployment_configs.production.env_vars.SPORT_DB_MODE_NFL.value, "shadow");
  assert.ok(plan.stream.d1_databases.MARKET_HISTORY_2026Q4_DB);
});

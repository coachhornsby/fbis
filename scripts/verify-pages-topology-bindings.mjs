#!/usr/bin/env node
/**
 * Post-deploy / operator check: Pages production + preview must expose the
 * full topology surface from topologyBindingGate (18 D1s + shadow modes).
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 * Does not authorize sport cutover.
 */
import {
  REQUIRED_PAGES_D1_BINDINGS,
  requiredSportModeVars,
  TOPOLOGY_BINDING_GATE_CONTRACT,
} from "../functions/lib/topologyBindingGate.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const PROJECT = process.env.PAGES_PROJECT_NAME || "fbis";

async function main() {
  if (!ACCOUNT || !TOKEN) {
    console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
    process.exit(2);
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`,
    { headers: { authorization: `Bearer ${TOKEN}` } }
  );
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(JSON.stringify(body.errors || body).slice(0, 500));
  }

  const configs = body.result?.deployment_configs || {};
  const requiredIds = Object.fromEntries(
    REQUIRED_PAGES_D1_BINDINGS.map((s) => [s.binding, s.databaseId])
  );
  const modeKeys = requiredSportModeVars().map((s) => s.key);

  const reportEnv = (name, cfg) => {
    const d1 = cfg?.d1_databases || {};
    const envVars = cfg?.env_vars || {};
    const missing = [];
    const wrongId = [];
    for (const [binding, id] of Object.entries(requiredIds)) {
      const actual = d1[binding]?.id || d1[binding]?.database_id || null;
      if (!actual) missing.push(binding);
      else if (actual !== id) wrongId.push({ binding, expected: id, actual });
    }
    const modeFailures = [];
    for (const key of modeKeys) {
      const value = String(envVars[key]?.value ?? envVars[key] ?? "").toLowerCase();
      if (value !== "shadow") modeFailures.push({ key, actual: value || null });
    }
    const legacyNhl = String(envVars.NHL_SPORT_DB_MODE?.value ?? envVars.NHL_SPORT_DB_MODE ?? "").toLowerCase();
    if (legacyNhl && legacyNhl !== "shadow") {
      modeFailures.push({ key: "NHL_SPORT_DB_MODE", actual: legacyNhl });
    }
    const ok = missing.length === 0 && wrongId.length === 0 && modeFailures.length === 0;
    return {
      env: name,
      ok,
      d1Count: Object.keys(d1).length,
      requiredCount: REQUIRED_PAGES_D1_BINDINGS.length,
      missing,
      wrongId,
      modeFailures,
    };
  };

  const production = reportEnv("production", configs.production);
  const preview = reportEnv("preview", configs.preview);
  const out = {
    contract: TOPOLOGY_BINDING_GATE_CONTRACT,
    project: PROJECT,
    ok: production.ok && preview.ok,
    production,
    preview,
    productionCutoverBlocked: true,
    canAuthorizeWager: false,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});

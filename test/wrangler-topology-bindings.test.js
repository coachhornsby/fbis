import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REQUIRED_PAGES_D1_BINDINGS,
  REQUIRED_STREAM_D1_BINDINGS,
  requiredSportModeVars,
} from "../functions/lib/topologyBindingGate.js";

const EXPECTED_PAGES_D1_COUNT = 18;

function parseTomlBindings(toml) {
  const bindingNames = [...toml.matchAll(/binding\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const counts = bindingNames.reduce((acc, name) => {
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  return { bindingNames, counts };
}

test("pages wrangler declares complete binding sets separately for base and independently approved NFL/CFB/NHL production", () => {
  const toml=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
  const [base,production=""]=toml.split("[env.production.vars]");
  assert.ok(production.length>0,"missing explicit production block");
  assert.equal(REQUIRED_PAGES_D1_BINDINGS.length,EXPECTED_PAGES_D1_COUNT);
  const baseCounts=parseTomlBindings(base).counts;
  const productionCounts=parseTomlBindings(production).counts;
  for (const [surface,counts] of [["base",baseCounts],["production",productionCounts]]) {
    const duplicates=Object.entries(counts).filter(([,n])=>n>1);
    assert.deepEqual(duplicates,[],surface+" duplicates");
    for (const spec of REQUIRED_PAGES_D1_BINDINGS){
      assert.equal(counts[spec.binding],1,surface+" missing "+spec.binding);
    }
    assert.equal(counts.ARCHIVE,1,surface+" ARCHIVE missing");
  }
  for (const spec of requiredSportModeVars()) {
    assert.ok(base.includes(spec.key + ' = "' + spec.expected + '"'),"shadow base "+spec.key);
    const expected=["SPORT_DB_MODE_NFL","SPORT_DB_MODE_CFB","SPORT_DB_MODE_NHL"].includes(spec.key)?"sport":"shadow";
    assert.ok(production.includes(spec.key + ' = "' + expected + '"'),"production "+spec.key);
  }
  assert.ok(production.includes('SPORT_DB_STRICT_NFL = "true"'));
  assert.ok(production.includes('SPORT_CUTOVER_RECEIPT_NFL = "nfl-20261021-production-v1"'));
  assert.ok(production.includes('SPORT_DB_STRICT_CFB = "true"'));
  assert.ok(production.includes('SPORT_DB_LEDGER_READY_CFB = "true"'));
  assert.ok(production.includes('SPORT_CUTOVER_RECEIPT_CFB = "cfb-20261021-production-v1"'));
  assert.ok(production.includes('SPORT_DB_STRICT_NHL = "true"'));
  assert.ok(production.includes('SPORT_DB_LEDGER_READY_NHL = "true"'));
  assert.ok(production.includes('SPORT_CUTOVER_RECEIPT_NHL = "nhl-20261022-production-v1"'));
});

test("stream wrangler declares Q4 market-history binding", () => {
  const toml = readFileSync(new URL("../wrangler.polymarket-us-stream.toml", import.meta.url), "utf8");
  const { counts } = parseTomlBindings(toml);
  const duplicates = Object.entries(counts).filter(([, n]) => n > 1);
  assert.deepEqual(duplicates, [], `duplicate stream wrangler bindings: ${JSON.stringify(duplicates)}`);

  for (const spec of REQUIRED_STREAM_D1_BINDINGS) {
    assert.equal(counts[spec.binding], 1, `stream binding ${spec.binding} must appear exactly once`);
    assert.match(toml, new RegExp(`binding\\s*=\\s*"${spec.binding}"`), `missing stream ${spec.binding}`);
    assert.ok(toml.includes(spec.databaseId), `missing stream database id for ${spec.binding}`);
  }
});

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

test("pages wrangler.toml declares full topology D1 bindings and shadow modes", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const { counts } = parseTomlBindings(toml);
  const duplicates = Object.entries(counts).filter(([, n]) => n > 1);
  assert.deepEqual(duplicates, [], `duplicate wrangler bindings: ${JSON.stringify(duplicates)}`);

  assert.equal(
    REQUIRED_PAGES_D1_BINDINGS.length,
    EXPECTED_PAGES_D1_COUNT,
    `REQUIRED_PAGES_D1_BINDINGS must stay at ${EXPECTED_PAGES_D1_COUNT}`
  );

  for (const spec of REQUIRED_PAGES_D1_BINDINGS) {
    assert.equal(counts[spec.binding], 1, `binding ${spec.binding} must appear exactly once`);
    assert.match(toml, new RegExp(`binding\\s*=\\s*"${spec.binding}"`), `missing ${spec.binding}`);
    assert.ok(toml.includes(spec.databaseId), `missing database id for ${spec.binding}`);
  }

  // Reject unsafe sport modes in wrangler vars (only shadow is allowed pre-cutover).
  for (const spec of requiredSportModeVars()) {
    assert.match(
      toml,
      new RegExp(`${spec.key}\\s*=\\s*"${spec.expected}"`),
      `missing shadow mode ${spec.key}`
    );
    assert.doesNotMatch(
      toml,
      new RegExp(`${spec.key}\\s*=\\s*"(primary|sport)"`, "i"),
      `unsafe mode for ${spec.key}`
    );
  }
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

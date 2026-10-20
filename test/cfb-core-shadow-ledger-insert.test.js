/**
 * Guard the prospective shadow INSERT bind shape.
 * An extra "?" previously made freeze writes fail at runtime.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("cfb_core_shadow_predictions INSERT placeholders match bind arity", () => {
  const src = readFileSync(
    resolve("functions/lib/cfbCoreShadowLedger.js"),
    "utf8"
  );
  const m = src.match(
    /INSERT OR IGNORE INTO cfb_core_shadow_predictions \([\s\S]*?\) VALUES \(([\s\S]*?)\)`/
  );
  assert.ok(m, "INSERT statement present");
  const values = m[1];
  const colBlock = m[0].match(/\(([^)]+)\)\s*VALUES/)[1];
  const cols = colBlock.split(",").map((s) => s.trim()).filter(Boolean);
  const qmarks = (values.match(/\?/g) || []).length;
  const literalZeros = (values.match(/\b0\b/g) || []).length;
  assert.equal(cols.length, 61, "column count");
  assert.equal(literalZeros, 3, "can_qualify/can_authorize/can_influence literals");
  assert.equal(qmarks + literalZeros, cols.length, "values cover every column");

  const bind = src.slice(src.indexOf(").bind("));
  const bindEnd = bind.indexOf("));");
  const bindArgs = bind.slice(0, bindEnd);
  // Count top-level commas in the first .bind( ... ) call roughly via r. / string literals.
  const argLines = bindArgs
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith(").bind"));
  // Expected: 58 bound params (authority + created_at included; three flags literal).
  assert.equal(qmarks, 58, "placeholder count");
  assert.ok(argLines.join(" ").includes('"research_only"'), "authority bound as research_only");
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("PBP enricher canon-maps LA→LAR so Rams join snapshot keys", () => {
  const code = [
    "import importlib.util",
    "from pathlib import Path",
    'p = Path("scripts/nfl-enrich-snapshot-pbp-families.py")',
    'spec = importlib.util.spec_from_file_location("enrich", p)',
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    'assert m.canon_team("LA") == "LAR"',
    'assert m.canon_team("LAR") == "LAR"',
    'assert m.canon_team("SD") == "LAC"',
    'assert m.canon_team("OAK") == "LV"',
    'assert m.canon_team("WSH") == "WAS"',
    'print("ok")',
  ].join("\n");
  const check = spawnSync("python3", ["-c", code], { encoding: "utf-8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /ok/);
});

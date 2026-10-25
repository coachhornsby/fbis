import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BOARD_SPORTS } from "../functions/lib/slateEngineCore.js";
import { PROP_SPORTS } from "../functions/lib/exchangePlayerProps.js";
import { SPORT_FILTERS } from "../src/app/navigation.js";
import { retiredSportApiGate } from "../functions/api/_middleware.js";

const APPROVED = ["nfl", "mlb", "nba", "nhl", "cfb", "cbb", "tennis"];
const RETIRED = ["npb", "kbo", "soccer", "wnba"];

test("FBIS board, exchange props and navigation share only the seven approved sports", () => {
  assert.deepEqual(BOARD_SPORTS, APPROVED);
  assert.deepEqual([...PROP_SPORTS], APPROVED);
  assert.deepEqual(SPORT_FILTERS.map((s) => s.id).filter((id) => id !== "all").sort(), [...APPROVED].sort());
  for (const id of RETIRED) {
    assert.ok(!BOARD_SPORTS.includes(id));
    assert.ok(!PROP_SPORTS.includes(id));
    assert.ok(!SPORT_FILTERS.some((s) => s.id === id));
  }
});

test("retired sport-specific GitHub workflows cannot start automatically", () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  const retired = readdirSync(dir).filter((name) => /^(asian-baseball|kbo-|soccer-|wnba-).*\.yml$/.test(name));
  assert.ok(retired.length > 0);
  for (const filename of retired) {
    const workflow = readFileSync(new URL(filename, dir), "utf8");
    const events = workflow.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] || "";
    assert.doesNotMatch(events, /^  (schedule|push|workflow_run):/m, filename);
  }
});

test("retired soccer Worker cron schedules are empty in both configs", () => {
  for (const filename of ["wrangler.soccer-backfill.toml", "wrangler.soccer-pitchapi.toml"]) {
    const config = readFileSync(new URL("../" + filename, import.meta.url), "utf8");
    assert.match(config, /^crons = \[\]/m, filename);
  }
});

test("retired API routes fail closed; explicit historical GET reads stay accessible", async () => {
  for (const name of ["soccer-pitchapi-ingest", "soccer-pitchapi-sync", "wnba-wager-decisions", "asian-baseball-pregame-controlled"]) {
    const path = "https://fbis.invalid/api/" + name;
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = retiredSportApiGate(new Request(path, { method }));
      assert.equal(response?.status, 410, name + " " + method);
      assert.equal((await response.json()).canAuthorizeWager, false);
    }
  }
  for (const name of ["soccer-pitchapi-export", "asian-baseball-history-backfill", "wnba-wager-decisions"]) {
    assert.equal(retiredSportApiGate(new Request("https://fbis.invalid/api/" + name)), null);
  }
  assert.equal(retiredSportApiGate(new Request("https://fbis.invalid/api/soccer-pitchapi-sync"))?.status, 410);
  assert.equal(retiredSportApiGate(new Request("https://fbis.invalid/api/today")), null);
});

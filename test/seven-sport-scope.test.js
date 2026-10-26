import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BOARD_SPORTS } from "../functions/lib/slateEngineCore.js";
import { PROP_SPORTS } from "../functions/lib/exchangePlayerProps.js";
import { SPORT_FILTERS } from "../src/app/navigation.js";
import { retiredSportApiGate } from "../functions/api/_middleware.js";
import { FBIS_POLY_SPORTS } from "../functions/lib/polymarketUs.js";
import { STREAM_SPORTS } from "../services/polymarket-us-stream/core.mjs";
import { onRequestGet as liveProjections } from "../functions/api/projections.js";
import { onRequestGet as marketObservations } from "../functions/api/market-observations.js";
import { groupActivePolymarketLeagues } from "../functions/api/polymarket-collect.js";
import { PRO_PLAYER_PROP_SPORTS, normalizeProPropSport, isProPlayerPropSport } from "../functions/lib/proPlayerProps.js";
import { LEARNING_SPORTS } from "../functions/lib/snapshotLearning.js";
import { onRequestGet as playerProps } from "../functions/api/player-props.js";
import { onRequestGet as selectiveProps } from "../functions/api/selective-props.js";

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

test("live exchange and WebSocket collectors use only the seven approved sports", () => {
  assert.deepEqual([...FBIS_POLY_SPORTS].sort(), [...APPROVED].sort());
  assert.deepEqual([...STREAM_SPORTS].sort(), [...APPROVED].sort());
});

test("retired live projection and market read paths fail closed without breaking archive opt-in", async () => {
  for (const sport of RETIRED) {
    const live = await liveProjections({ request: new Request("https://fbis.invalid/api/projections?sport=" + sport), env: {} });
    assert.equal(live.status, 400, sport + " live projection");
    const direct = await marketObservations({ request: new Request("https://fbis.invalid/api/market-observations?sport=" + sport + "&eventId=historical"), env: {} });
    assert.equal(direct.status, 400, sport + " direct market query");
    const historical = await marketObservations({ request: new Request("https://fbis.invalid/api/market-observations?historical=1&sport=" + sport + "&eventId=historical"), env: {} });
    assert.equal(historical.status, 503, sport + " archived query accepted but unavailable without DB");
  }
});

test("retired Polymarket provider leagues are skipped without crashing collection", () => {
  const leagues = [
    {slug:"nfl",name:"National Football League"},
    {slug:"wnba",name:"WNBA"},
    {slug:"npb",name:"NPB"},
    {slug:"kbo",name:"KBO"},
    {slug:"epl",name:"English Premier League"},
    {slug:"wta",name:"WTA Tour"},
    {slug:"mlb",name:"MLB"},
  ];
  const grouped = groupActivePolymarketLeagues(leagues);
  assert.deepEqual([...grouped.keys()].sort(), [...APPROVED].sort());
  assert.deepEqual(grouped.get("nfl"), ["nfl"]);
  assert.deepEqual(grouped.get("tennis"), ["wta"]);
  assert.deepEqual(grouped.get("mlb"), ["mlb"]);
  for (const retired of RETIRED) assert.equal(grouped.has(retired), false);
});

test("only active sports are accepted by live prop normalization and learning", async () => {
  assert.deepEqual([...PRO_PLAYER_PROP_SPORTS].sort(), [...APPROVED].sort());
  assert.deepEqual([...LEARNING_SPORTS].sort(), ["nfl","mlb","nba","nhl","cfb","cbb"].sort());
  for (const retired of RETIRED) {
    assert.equal(isProPlayerPropSport(retired), false);
    const prop = await playerProps({ request:new Request("https://fbis.invalid/api/player-props?sport="+retired), env:{DB:{}} });
    assert.equal(prop.status, 200);
    assert.deepEqual((await prop.json()).rows, []);
    const selective = await selectiveProps({ request:new Request("https://fbis.invalid/api/selective-props?sport="+retired), env:{DB:{}} });
    assert.equal(selective.status, 400);
  }
});


test("production prop acceptance audit follows the active exchange sport scope", () => {
  const source = readFileSync(new URL("../scripts/audit-prop-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /import\s+\{\s*PROP_SPORTS\s*\}\s+from\s+['"]\.\.\/functions\/lib\/exchangePlayerProps\.js['"]/);
  assert.match(source, /process\.argv\[3\]\s*\|\|\s*PROP_SPORTS\.join/);
  assert.doesNotMatch(source, /nfl,nba,nhl,mlb,cfb,wnba,cbb,tennis,soccer,npb,kbo/);
});

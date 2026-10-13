import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  classifyFreeOddsSlate,
  emptySlateReadbackValidated,
  verifyCtScheduleGameCount,
} from "../functions/lib/freeOddsSlateGuard.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function jqBool(filter, json) {
  const out = execFileSync("jq", ["-e", filter], {
    input: JSON.stringify(json),
    encoding: "utf8",
  }).trim();
  return out === "true";
}

function jqExitOk(filter, json) {
  try {
    execFileSync("jq", ["-e", filter], {
      input: JSON.stringify(json),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

const NHL_SUCCESS_FILTER = `
  (.ok==true and .skipped==true and .skipReason=="EMPTY_SLATE"
    and .scheduledGames==0 and .signalClass=="EXPECTED_EMPTY_SLATE")
  or
  (.ok==true and .skipped!=true
    and (.scheduledGames|type=="number") and .scheduledGames>0
    and .pairedMoneylines>0
    and .persistedMoneylineRows>=(.pairedMoneylines*2)
    and .readbackValidated==true
    and .canQualify==false and .canAuthorizeWager==false)
`;

const PITCH_CONTRACT = `
  .ok == true
  and (.empty | type == "boolean")
  and (.pendingEligible | type == "number" and . >= 0 and . == floor)
  and (
    (.empty == true and .pendingEligible == 0)
    or (.empty == false and .pendingEligible > 0)
  )
`;

test("classifyFreeOddsSlate: EMPTY_SLATE only when schedule verified empty", () => {
  assert.equal(
    classifyFreeOddsSlate({
      scheduleOk: true,
      scheduledGames: 0,
      pairedMoneylines: 0,
      persistedMoneylineRows: 0,
    }).kind,
    "EMPTY_SLATE"
  );
  assert.equal(
    classifyFreeOddsSlate({
      scheduleOk: true,
      scheduledGames: 3,
      pairedMoneylines: 0,
      persistedMoneylineRows: 0,
    }).kind,
    "COVERAGE_GAP"
  );
  assert.equal(
    classifyFreeOddsSlate({
      scheduleOk: false,
      scheduledGames: null,
      pairedMoneylines: 0,
      persistedMoneylineRows: 0,
    }).kind,
    "SCHEDULE_UNVERIFIED"
  );
  assert.equal(
    classifyFreeOddsSlate({
      scheduleOk: true,
      scheduledGames: 2,
      pairedMoneylines: 2,
      persistedMoneylineRows: 4,
    }).kind,
    "OK"
  );
  assert.equal(emptySlateReadbackValidated(), null);
});

test("verifyCtScheduleGameCount uses independent schedule APIs (mocked)", async () => {
  const mlbFetch = async (url) => {
    assert.match(String(url), /statsapi\.mlb\.com/);
    return {
      ok: true,
      json: async () => ({ dates: [{ games: [{ id: 1 }, { id: 2 }] }] }),
    };
  };
  const mlb = await verifyCtScheduleGameCount("mlb", "2026-10-12", { fetchImpl: mlbFetch });
  assert.equal(mlb.ok, true);
  assert.equal(mlb.scheduledGames, 2);
  assert.equal(mlb.scheduleSource, "mlb-statsapi");

  const nhlFetch = async (url) => {
    assert.match(String(url), /api-web\.nhle\.com/);
    return {
      ok: true,
      json: async () => ({
        gameWeek: [{ date: "2026-10-12", games: [{ id: 10 }] }],
      }),
    };
  };
  const nhl = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl: nhlFetch });
  assert.equal(nhl.ok, true);
  assert.equal(nhl.scheduledGames, 1);
  assert.equal(nhl.scheduleSource, "nhl-official-schedule");

  const emptyMlb = await verifyCtScheduleGameCount("mlb", "2026-10-12", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ dates: [] }) }),
  });
  assert.equal(emptyMlb.scheduledGames, 0);

  const bad = await verifyCtScheduleGameCount("mlb", "2026-10-12", {
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(bad.ok, false);
});

test("NHL workflow jq rejects games>0 with zero paired moneylines", () => {
  assert.equal(
    jqExitOk(NHL_SUCCESS_FILTER, {
      ok: true,
      skipped: false,
      scheduledGames: 1,
      pairedMoneylines: 0,
      persistedMoneylineRows: 0,
      readbackValidated: true,
      canQualify: false,
      canAuthorizeWager: false,
    }),
    false
  );
  assert.equal(
    jqExitOk(NHL_SUCCESS_FILTER, {
      ok: true,
      skipped: true,
      skipReason: "EMPTY_SLATE",
      scheduledGames: 0,
      signalClass: "EXPECTED_EMPTY_SLATE",
    }),
    true
  );
  assert.equal(
    jqExitOk(NHL_SUCCESS_FILTER, {
      ok: true,
      skipped: false,
      scheduledGames: 2,
      pairedMoneylines: 2,
      persistedMoneylineRows: 4,
      readbackValidated: true,
      canQualify: false,
      canAuthorizeWager: false,
    }),
    true
  );
});

test("PitchAPI preflight jq: empty:false enables work; empty:true skips; malformed fails", () => {
  // Reproduce the original defect: false // true === true in jq
  assert.equal(jqBool(".empty // true", { empty: false }), true);

  assert.equal(
    jqExitOk(PITCH_CONTRACT, { ok: true, empty: false, pendingEligible: 25 }),
    true
  );
  assert.equal(
    jqExitOk(PITCH_CONTRACT, { ok: true, empty: true, pendingEligible: 0 }),
    true
  );
  assert.equal(
    jqExitOk(PITCH_CONTRACT, { ok: true, empty: false, pendingEligible: 0 }),
    false
  );
  assert.equal(jqExitOk(PITCH_CONTRACT, { ok: true, pendingEligible: 3 }), false);
  assert.equal(jqExitOk(PITCH_CONTRACT, { empty: false, pendingEligible: 3 }), false);
  assert.equal(
    jqExitOk(PITCH_CONTRACT, { ok: true, empty: "yes", pendingEligible: 1 }),
    false
  );

  // Strict .empty string compare used by workflow after contract check
  assert.equal(execFileSync("jq", ["-r", ".empty"], {
    input: JSON.stringify({ empty: false }),
    encoding: "utf8",
  }).trim(), "false");
});

test("workflow sources use strict empty parsing and schedule-gated EMPTY_SLATE", async () => {
  const nhlYml = await read(".github/workflows/nhl-free-odds-collect.yml");
  const mlbYml = await read(".github/workflows/mlb-free-odds-collect.yml");
  const pitchYml = await read(".github/workflows/soccer-pitchapi-queue-drain.yml");
  const nhlApi = await read("functions/api/nhl-free-odds-collect.js");
  const mlbApi = await read("functions/api/mlb-free-odds-collect.js");

  for (const yml of [nhlYml, mlbYml]) {
    assert.match(yml, /pairedMoneylines>0/);
    assert.match(yml, /scheduledGames==0/);
    assert.match(yml, /EXPECTED_EMPTY_SLATE/);
  }
  assert.doesNotMatch(pitchYml, /\.empty\s*\/\/\s*true/);
  assert.match(pitchYml, /\.empty \| type == "boolean"/);
  assert.match(pitchYml, /elif \[ "\$empty" = "false" \]/);
  assert.match(pitchYml, /has_work=true/);
  assert.match(nhlApi, /verifyCtScheduleGameCount/);
  assert.match(mlbApi, /verifyCtScheduleGameCount/);
  assert.match(nhlApi, /pairedPersisted/);
  assert.match(mlbApi, /emptySlateReadbackValidated/);
});

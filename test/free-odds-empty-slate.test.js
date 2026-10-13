import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  classifyFreeOddsSlate,
  emptySlateReadbackValidated,
  verifyCtScheduleGameCount,
  chicagoDayFromIso,
  shiftYmd,
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

  // 00:30 UTC on Oct 13 is still Oct 12 in America/Chicago (CDT).
  const nhlFetch = async (url) => {
    assert.match(String(url), /api-web\.nhle\.com/);
    return {
      ok: true,
      json: async () => ({
        gameWeek: [{
          date: "2026-10-12",
          games: [{ id: 10, startTimeUTC: "2026-10-13T00:30:00Z" }],
        }],
      }),
    };
  };
  const nhl = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl: nhlFetch });
  assert.equal(nhl.ok, true);
  assert.equal(nhl.scheduledGames, 1);
  assert.equal(nhl.scheduleSource, "nhl-official-schedule");
  assert.equal(chicagoDayFromIso("2026-10-13T00:30:00Z"), "2026-10-12");

  const emptyMlb = await verifyCtScheduleGameCount("mlb", "2026-10-12", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ dates: [] }) }),
  });
  assert.equal(emptyMlb.scheduledGames, 0);

  const bad = await verifyCtScheduleGameCount("mlb", "2026-10-12", {
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(bad.ok, false);
});

test("NHL missing gameWeek target date is not EMPTY_SLATE — ESPN fallback or unverified", async () => {
  // Official returns a week that never includes 2026-10-12 → must not certify zero.
  let espnHits = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("api-web.nhle.com")) {
      return {
        ok: true,
        json: async () => ({
          gameWeek: [{ date: "2026-10-11", games: [{ id: 1, startTimeUTC: "2026-10-11T23:00:00Z" }] }],
        }),
      };
    }
    if (u.includes("site.api.espn.com")) {
      espnHits++;
      return {
        ok: true,
        json: async () => ({
          events: [{ id: "401", date: "2026-10-12T23:00:00Z" }],
        }),
      };
    }
    throw new Error(`unexpected url ${u}`);
  };
  const viaEspn = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl });
  assert.equal(viaEspn.ok, true);
  assert.equal(viaEspn.scheduledGames, 1);
  assert.equal(viaEspn.scheduleSource, "espn-nhl-scoreboard");
  assert.ok(espnHits > 0);

  const unverified = await verifyCtScheduleGameCount("nhl", "2026-10-12", {
    fetchImpl: async (url) => {
      if (String(url).includes("api-web.nhle.com")) {
        return {
          ok: true,
          json: async () => ({ gameWeek: [{ date: "2026-10-14", games: [] }] }),
        };
      }
      return { ok: false, status: 503 };
    },
  });
  assert.equal(unverified.ok, false);
  assert.match(String(unverified.error), /nhl-schedule-date-absent|nhl-schedule-unverified/);
  assert.equal(unverified.scheduledGames, null);
});

test("NHL CT boundary: adjacent official day supplies game for requested Chicago date", async () => {
  // Game listed under official calendar 2026-10-13 but tip-off is still 2026-10-12 CT.
  const fetchImpl = async (url) => {
    const day = String(url).split("/").pop();
    if (day === "2026-10-13") {
      return {
        ok: true,
        json: async () => ({
          gameWeek: [{
            date: "2026-10-13",
            games: [{ id: 99, startTimeUTC: "2026-10-13T04:00:00Z" }], // 11pm CT Oct 12
          }],
        }),
      };
    }
    // Other adjacent days return weeks that include the requested calendar row empty.
    return {
      ok: true,
      json: async () => ({
        gameWeek: [{ date: "2026-10-12", games: [] }],
      }),
    };
  };
  assert.equal(chicagoDayFromIso("2026-10-13T04:00:00Z"), "2026-10-12");
  assert.equal(shiftYmd("2026-10-12", 1), "2026-10-13");
  const result = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.scheduledGames, 1);
  assert.equal(result.scheduleSource, "nhl-official-schedule");
});

test("NHL verified empty requires requested calendar row present", async () => {
  // All adjacent official days succeed; requested row empty; no CT games.
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      gameWeek: [{ date: "2026-10-12", games: [] }],
    }),
  });
  const empty = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl });
  assert.equal(empty.ok, true);
  assert.equal(empty.scheduledGames, 0);
  assert.equal(empty.scheduleSource, "nhl-official-schedule");
});

test("NHL partial adjacent outage does not certify EMPTY_SLATE", async () => {
  // Requested Sunday row succeeds empty, but Monday official fails — a CT-Sunday
  // tip-off may live on Monday's feed. Must fall back (or go red), never empty.
  let espnHits = 0;
  const fetchImplRecoverable = async (url) => {
    const u = String(url);
    if (u.includes("api-web.nhle.com")) {
      const day = u.split("/").pop();
      if (day === "2026-10-13") return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({
          gameWeek: [{ date: "2026-10-12", games: [] }],
        }),
      };
    }
    if (u.includes("site.api.espn.com")) {
      espnHits++;
      return {
        ok: true,
        json: async () => ({
          events: [{ id: "401", date: "2026-10-13T04:00:00Z" }], // Sunday 11pm CT
        }),
      };
    }
    throw new Error(`unexpected ${u}`);
  };
  const recovered = await verifyCtScheduleGameCount("nhl", "2026-10-12", {
    fetchImpl: fetchImplRecoverable,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.scheduledGames, 1);
  assert.equal(recovered.scheduleSource, "espn-nhl-scoreboard");
  assert.ok(espnHits > 0);

  const fetchImplRed = async (url) => {
    const u = String(url);
    if (u.includes("api-web.nhle.com")) {
      const day = u.split("/").pop();
      if (day === "2026-10-13") return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({
          gameWeek: [{ date: "2026-10-12", games: [] }],
        }),
      };
    }
    return { ok: false, status: 502 };
  };
  const red = await verifyCtScheduleGameCount("nhl", "2026-10-12", { fetchImpl: fetchImplRed });
  assert.equal(red.ok, false);
  assert.match(String(red.error), /nhl-schedule-partial-outage|nhl-schedule-unverified/);
  assert.equal(red.scheduledGames, null);
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

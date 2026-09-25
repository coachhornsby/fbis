import test from "node:test";
import assert from "node:assert/strict";
import { resolveTeamExact } from "../functions/lib/teams.js";
import { mergeParlay } from "../functions/lib/parlay.js";

test("Appalachian State resolves to canonical App State", () => {
  const team = resolveTeamExact("cfb", { name: "Appalachian State" });
  assert.ok(team);
  assert.equal(String(team.espnId), "2026");
  assert.equal(team.school, "App State");
});

test("cached adjacent-date odds cannot create off-date slate stubs", () => {
  const friday = {
    parlayId: "fri",
    commence: "2026-09-26T00:00:00.000Z", // Fri Sep 25, 7:00 PM CT
    homeTeam: "Rutgers Scarlet Knights",
    awayTeam: "Howard Bison",
    spread: -30,
    total: 52,
  };
  const saturday = {
    parlayId: "sat",
    commence: "2026-09-26T17:00:00.000Z", // Sat Sep 26, noon CT
    homeTeam: "NC State Wolfpack",
    awayTeam: "Appalachian State",
    spread: -7,
    total: 51,
  };
  const out = mergeParlay([], [friday, saturday], "cfb", "2026-09-26");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "sat");
  assert.equal(out[0].home.name, "NC State");
  assert.equal(out[0].away.name, "App State");
});

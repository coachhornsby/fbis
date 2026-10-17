import test from "node:test";
import assert from "node:assert/strict";
import { cbbSeasonYear } from "../functions/lib/collegeApi.js";
import { torvikEndingSeason } from "../functions/lib/torvikCbb.js";
import { kenpomEndingSeason } from "../functions/lib/kenpomCbb.js";

test("CBBD season is ending year across the season crossover", ()=>{
  assert.equal(cbbSeasonYear(new Date("2026-10-20T15:00:00Z")),2027);
  assert.equal(cbbSeasonYear(new Date("2026-11-20T15:00:00Z")),2027);
  assert.equal(cbbSeasonYear(new Date("2027-01-20T15:00:00Z")),2027);
  assert.equal(cbbSeasonYear(new Date("2027-04-20T15:00:00Z")),2027);
  assert.equal(cbbSeasonYear(new Date("2027-09-20T15:00:00Z")),2027);
});
test("CBBD ending year correctly maps back to Torvik and KenPom start-year inputs",()=>{
  const cbbdEndingSeason = cbbSeasonYear(new Date("2026-11-15T15:00:00Z"));
  const adapterStartSeason = cbbdEndingSeason - 1;
  assert.equal(torvikEndingSeason(adapterStartSeason),cbbdEndingSeason);
  assert.equal(kenpomEndingSeason(adapterStartSeason),cbbdEndingSeason);
});

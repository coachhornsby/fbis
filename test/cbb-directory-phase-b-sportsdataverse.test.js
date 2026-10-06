import test from "node:test";
import assert from "node:assert/strict";
import { CBB_SD_SOURCES, normalizeRoster, normalizeGameRoster, releaseUrl } from "../scripts/cbb-directory-phase-b-sportsdataverse.mjs";

test("Phase B SportsDataverse inputs are immutable digest-pinned releases", () => {
  assert.equal(Object.keys(CBB_SD_SOURCES).length, 6);
  for (const s of Object.values(CBB_SD_SOURCES)) {
    assert.match(s.sha256, /^[a-f0-9]{64}$/);
    assert.match(releaseUrl(s), /^https:\/\/github\.com\/sportsdataverse\/sportsdataverse-data\/releases\/download\//);
  }
});

test("roster adapter preserves stable ESPN identity and UNKNOWN availability", () => {
  const [r]=normalizeRoster([{athlete_id:"42",team_id:"7",full_name:"A Player",uid:"u",guid:"g",position_abbreviation:"G"}],"2026-10-06T00:00:00Z");
  assert.equal(r.providerPlayerId,"42"); assert.equal(r.providerTeamId,"7"); assert.equal(r.availability,"UNKNOWN");
});

test("DNP/active flags never become availability status", () => {
  const [r]=normalizeGameRoster([{athlete_id:"42",team_id:"7",game_id:"9",starter:"false",did_not_play:"true",active:"false"}],"2026-10-06T00:00:00Z");
  assert.equal(r.didNotPlay,true); assert.equal(r.active,false); assert.equal(r.availability,"UNKNOWN");
});

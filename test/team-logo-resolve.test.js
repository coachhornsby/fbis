import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeTeamQuery, scoreMatch } from "../functions/api/team-logo.js";

test("LA canonicalizes to LAR for NFL so Rams beat Falcons", () => {
  assert.equal(canonicalizeTeamQuery("nfl", "LA"), "LAR");
  assert.equal(canonicalizeTeamQuery("nfl", "la"), "LAR");
  assert.equal(canonicalizeTeamQuery("nfl", "LAR"), "LAR");
  assert.equal(canonicalizeTeamQuery("nfl", "ATL"), "ATL");
});

test("short LA query does not substring-match Atlanta Falcons", () => {
  const falcons = {
    displayName: "Atlanta Falcons",
    name: "Atlanta Falcons",
    location: "Atlanta",
    nickname: "Falcons",
    abbreviation: "ATL",
  };
  const rams = {
    displayName: "Los Angeles Rams",
    name: "Los Angeles Rams",
    location: "Los Angeles",
    nickname: "Rams",
    abbreviation: "LAR",
  };
  assert.equal(scoreMatch("LA", falcons), 0);
  assert.equal(scoreMatch("LAR", rams), 100);
  assert.ok(scoreMatch("LAR", falcons) < 75);
  assert.equal(scoreMatch("LA", rams), 0); // raw LA before alias — abbr is LAR
  assert.equal(scoreMatch("LAR", { ...rams, abbreviation: "LAR" }), 100);
});

test("aliased LA lookup scores Rams as exact abbr", () => {
  const rams = {
    displayName: "Los Angeles Rams",
    abbreviation: "LAR",
    location: "Los Angeles",
    nickname: "Rams",
  };
  const falcons = {
    displayName: "Atlanta Falcons",
    abbreviation: "ATL",
    location: "Atlanta",
    nickname: "Falcons",
  };
  const q = canonicalizeTeamQuery("nfl", "LA");
  assert.equal(scoreMatch(q, rams), 100);
  assert.ok(scoreMatch(q, falcons) < 75);
});

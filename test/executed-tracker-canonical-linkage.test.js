import test from "node:test";
import assert from "node:assert/strict";
import { selectTrackerCanonicalGameId } from "../functions/api/bets.js";

const ticket = {
  sport: "cfb",
  date: "2026-10-10",
  awayTeam: "Hawaii",
  homeTeam: "Arizona State",
};

test("canonical game matching accepts punctuation-normalized team names", () => {
  const rows = [{ id: "401856808", sport: "cfb", date: "2026-10-10", away_name: "Hawai'i", home_name: "Arizona State" }];
  assert.equal(selectTrackerCanonicalGameId(ticket, rows), "401856808");
});

test("one authoritative game ID wins over duplicate legacy ingestions", () => {
  const rows = [
    { id: "ncaaf_hawaii_20261010", sport: "cfb", date: "2026-10-10", away_name: "Hawaii", home_name: "Arizona State" },
    { id: "401856808", sport: "cfb", date: "2026-10-10", away_name: "Hawai'i", home_name: "Arizona State" },
  ];
  assert.equal(selectTrackerCanonicalGameId(ticket, rows), "401856808");
});

test("ambiguous provider IDs fail closed", () => {
  const row = { sport: "cfb", date: "2026-10-10", away_name: "Hawaii", home_name: "Arizona State" };
  assert.equal(selectTrackerCanonicalGameId(ticket, [{...row,id:"401856808"},{...row,id:"401856809"}]), null);
});

test("date, sport and exact team identities must all match", () => {
  const row = {id:"401856808",sport:"cfb",date:"2026-10-10",away_name:"Hawai'i",home_name:"Arizona State"};
  assert.equal(selectTrackerCanonicalGameId({...ticket,date:"2026-10-09"},[row]),null);
  assert.equal(selectTrackerCanonicalGameId({...ticket,sport:"nhl"},[row]),null);
  assert.equal(selectTrackerCanonicalGameId({...ticket,awayTeam:"Hawaii State"},[row]),null);
});

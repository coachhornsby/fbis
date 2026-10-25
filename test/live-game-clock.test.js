import test from "node:test";
import assert from "node:assert/strict";
import { formatLiveGameClock } from "../src/lib/liveGameClock.js";

test("CFB observed period and clock", () => {
  assert.equal(formatLiveGameClock({sport:"cfb",status:"live",statusPeriod:3,statusClock:"7:42",statusDetail:"7:42 - 3rd"}),"Q3 · 7:42 LEFT");
});
test("ESPN short detail fallback reads game clock without kickoff inference", () => {
  assert.equal(formatLiveGameClock({sport:"cfb",status:"live",statusDetail:"12:07 - 2nd"}),"Q2 · 12:07 LEFT");
});
test("halftime and extra periods", () => {
  assert.equal(formatLiveGameClock({sport:"cfb",status:"halftime",statusDetail:"Halftime"}),"HALFTIME");
  assert.equal(formatLiveGameClock({sport:"nfl",status:"live",statusPeriod:5,statusClock:"7:20"}),"OT · 7:20");
});
test("no fabricated minutes for missing clock", () => {
  assert.equal(formatLiveGameClock({sport:"cfb",status:"live",statusPeriod:4,statusDetail:"In Progress"}),"Q4 · CLOCK N/A");
  assert.equal(formatLiveGameClock({sport:"cfb",status:"final",statusPeriod:4,statusClock:"0:00"}),null);
  assert.equal(formatLiveGameClock({sport:"cfb",status:"scheduled"}),null);
});

test("MLB top of fifth inning uses inning, not clock", () => {
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusInning:5,statusInningHalf:"TOP"}),"TOP · 5TH");
});
test("MLB bottom ninth and postseason extra innings", () => {
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusInning:9,statusInningHalf:"BOT"}),"BOT · 9TH");
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusInning:10,statusInningHalf:"TOP"}),"TOP · 10TH");
});
test("MLB middle of inning and ESPN status fallback", () => {
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusInning:6,statusInningHalf:"MID"}),"MID · 6TH");
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusDetail:"Top 7th"}),"TOP · 7TH");
});
test("MLB inning unavailable never displays CLOCK N/A", () => {
  assert.equal(formatLiveGameClock({sport:"mlb",status:"live",statusDetail:"In Progress"}),"INNING N/A");
  assert.equal(formatLiveGameClock({sport:"mlb",status:"final",statusInning:9,statusInningHalf:"BOT"}),null);
});

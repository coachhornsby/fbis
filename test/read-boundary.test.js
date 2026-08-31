import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("slate GET is display-only and cannot freeze or harvest", () => {
  const source = read("functions/api/slate.js");
  assert.doesNotMatch(source, /freezeSlate|harvestSport|waitUntil/);
  assert.match(source, /buildSlate/);
});

test("bets GET only reads durable executed-bet history", () => {
  const source = read("functions/api/bets.js");
  const getStart = source.indexOf("export async function handleBetsGet");
  const getEnd = source.indexOf("function heritageDateWindow", getStart);
  const getBody = source.slice(getStart, getEnd);
  assert.match(getBody, /queryExecutedBets/);
  assert.doesNotMatch(getBody, /persist|update|settle|grade|waitUntil/i);
});

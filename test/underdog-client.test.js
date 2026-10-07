import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeUnderdogPayload, filterUnderdogLines } from "../functions/lib/underdogClient.js";
import { mapUnderdogStat } from "../functions/lib/underdogStatMaps.js";
import { compareEquivalentPropLines } from "../functions/lib/marketLineComparison.js";

const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/underdog-live-v3.json",import.meta.url),"utf8"));

test("normalizes stored live-schema fixture",()=>{
  const r=normalizeUnderdogPayload(fixture,{fetchedAt:"2026-10-07T12:00:00Z"});
  assert.equal(r.ok,true); assert.equal(r.rawCount,4); assert.equal(r.normalizedCount,4);
  const ace=r.lines.find(x=>x.rawIds.lineId==="l1");
  assert.equal(ace.playerName,"Taylor Fritz"); assert.equal(ace.statFamily,"aces"); assert.equal(ace.line,8.5);
  assert.equal(ace.lineType,"standard"); assert.equal(ace.availability.over,true); assert.equal(ace.availability.under,true);
});
test("missing players array is explicit and rows are unusable",()=>{
  const x={...fixture};delete x.players;const r=normalizeUnderdogPayload(x);
  assert.ok(r.warnings.includes("MISSING_PLAYERS_ARRAY"));assert.ok(r.lines.every(row=>row.usableForAutomatedComparison===false));
});
test("missing appearances array is explicit",()=>{
  const x={...fixture};delete x.appearances;const r=normalizeUnderdogPayload(x);
  assert.ok(r.warnings.includes("MISSING_APPEARANCES_ARRAY"));assert.ok(r.warnings.some(w=>w.startsWith("UNRESOLVED_APPEARANCE")));
});
test("duplicate lines are deduplicated with warning",()=>{
  const x={...fixture,over_under_lines:[fixture.over_under_lines[0],{...fixture.over_under_lines[0],id:"dup"}]};
  const r=normalizeUnderdogPayload(x);assert.equal(r.lines.length,1);assert.ok(r.warnings.some(w=>w.startsWith("DUPLICATE_LINE")));
});
test("invalid stat_value is unusable",()=>{
  const x={...fixture,over_under_lines:[{...fixture.over_under_lines[0],stat_value:"bad"}]};
  const r=normalizeUnderdogPayload(x);assert.equal(r.lines[0].usableForAutomatedComparison,false);assert.ok(r.warnings.some(w=>w.startsWith("INVALID_STAT_VALUE")));
});
test("unresolved appearance is unusable",()=>{
  const x={...fixture,over_under_lines:[{...fixture.over_under_lines[0],appearance_id:"missing"}]};
  const r=normalizeUnderdogPayload(x);assert.equal(r.lines[0].usableForAutomatedComparison,false);assert.ok(r.warnings.includes("UNRESOLVED_APPEARANCE:missing"));
});
test("sport filtering works",()=>{
  const r=filterUnderdogLines(normalizeUnderdogPayload(fixture),{sport:"tennis"});assert.equal(r.lines.length,2);assert.ok(r.lines.every(x=>x.sport==="tennis"));
});
test("verified sport stat maps remain exact",()=>{
  assert.equal(mapUnderdogStat("tennis","Aces").statFamily,"aces");
  assert.equal(mapUnderdogStat("tennis","Double Faults").statFamily,"double_faults");
  assert.equal(mapUnderdogStat("nfl","Passing Yards").statFamily,"passing_yards");
  assert.equal(mapUnderdogStat("nfl","Rush + Receiving Yards").statFamily,"rush_receiving_yards");
  assert.equal(mapUnderdogStat("mlb","H+R+RBI").statFamily,"hits_runs_rbis");
  assert.equal(mapUnderdogStat("nba","PRA").statFamily,"points_rebounds_assists");
});
test("promo is never silently standard",()=>{
  const r=normalizeUnderdogPayload(fixture);assert.equal(r.lines.find(x=>x.rawIds.lineId==="l2").lineType,"promo");
});
test("CS2 Maps 1+2 mapping is preserved in shared map",()=>{
  assert.equal(mapUnderdogStat("cs2","Maps 1+2 Kills").statFamily,"maps_1_2_kills");
  assert.equal(mapUnderdogStat("cs2","Maps 1+2 Headshots").statFamily,"maps_1_2_headshots");
});
test("line comparison reports shopping thresholds without bet authority",()=>{
  const r=compareEquivalentPropLines([
    {platform:"underdog",sport:"tennis",playerName:"A",statFamily:"aces",eventId:"e",line:7.5,timestamp:"2026-10-07T12:00:00Z"},
    {platform:"prizepicks",sport:"tennis",playerName:"A",statFamily:"aces",eventId:"e",line:8.5,timestamp:"2026-10-07T12:01:00Z"},
  ],{nowMs:Date.parse("2026-10-07T12:02:00Z")});
  assert.equal(r[0].lowestOverThreshold,7.5);assert.equal(r[0].highestUnderThreshold,8.5);assert.equal(r[0].lineDisagreement,1);assert.equal(r[0].governance,"MARKET_SHOPPING_ONLY");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("PrizePicks workflow has redundant guarded morning schedules and a workflow-file-only recovery trigger",()=>{
  const y=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
  assert.match(y,/cron: "5,35 13,14,15,16 \* \* \*"/);
  assert.doesNotMatch(y,/timezone:/);
  assert.match(y,/push:\s*\n\s+branches: \[main\]\s*\n\s+paths: \["\.github\/workflows\/prizepicks-targeted-props\.yml"\]/);
  assert.match(y,/Reuse existing daily reservation without a replacement paid call/);
  assert.match(y,/RECOVER_ARTIFACT/);
  assert.match(y,/Reserve today's single paid PrizePicks acquisition/);
  assert.match(y,/Pull full PrizePicks board once/);
  assert.doesNotMatch(y,/playerNames:\$players/);
  assert.doesNotMatch(y,/run-sync-get-dataset-items|listLeagues/);
  assert.match(y,/api\/apify-acquire/);
  assert.match(y,/bounded resumable batches/);
});
test("PrizePicks API enforces durable daily acquisition reservation",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
  assert.match(s,/ALREADY_COLLECTED_TODAY/);
  assert.match(s,/prizepicks_daily_acquisitions/);
  assert.match(s,/ESTIMATED_START/);
  assert.match(s,/stale_past_prizepicks_rows/);
  assert.doesNotMatch(s,/future_or_non_today_prizepicks_rows/);
});
test("legacy paid collector is disabled",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-collect.js","utf8");
  assert.match(s,/LEGACY_PRIZEPICKS_COLLECTOR_DISABLED/);
  assert.doesNotMatch(s,/await runActor\(/);
});

test("PrizePicks workflow reports degraded ingestion separately from budget-safe collection skip",()=>{
  const y=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
  const api=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
  assert.match(y,/name: Assert durable daily ingestion health\s*\n\s*if: always\(\)/);
  assert.match(y,/mode=ingestion_health/);
  assert.match(y,/if \[ "\$code" != "200" \] \|\| \[ "\$healthy" != "true" \]/);
  assert.match(y,/SKIP_COLLECTION=1/);
  assert.match(api,/mode==="ingestion_health"/);
  assert.match(api,/acquisition\?\.state==="COMPLETE"/);
  assert.match(api,/LEFT JOIN nfl_prop_state_snapshots s ON s\.prop_line_id=p\.id/);
  assert.match(api,/DAILY_CAPTURE_NOT_COMPLETE/);
  assert.match(api,/NFL_STATE_SNAPSHOT_GAP/);
  assert.match(api,/canQualify:false,canAuthorizeWager:false/);
});


test("offline free NFL mirror audit accepts six standard markets but creates no authoritative evidence",async()=>{
  const {auditFreeNflMirror}=await import("../scripts/audit-free-prop-mirror.mjs");
  const feed={sport:"NFL",scrapedAt:"2026-10-10T12:09:36Z",collectionStatus:{ok:true,sourceCount:7,providerFetchedAt:"2026-10-10T12:08:00Z"},props:[
    {projectionId:"p1",playerId:"1",stat:"Pass Yards",line:"200.5",gameId:"provider1",startTimeIso:"2026-10-11T13:30:00Z",teamCode:"JAC",opponentCode:"PHI",providerFetchedAt:"2026-10-10T12:08:00Z"},
    {projectionId:"p2",playerId:"2",stat:"Receiving Yards",line:"50.5",gameId:"provider1",startTimeIso:"2026-10-11T13:30:00Z",teamCode:"PHI",opponentCode:"JAC",providerFetchedAt:"2026-10-10T12:08:00Z"},
    {projectionId:"p3",playerId:"1",stat:"Passer Rating",line:"90",gameId:"provider1",startTimeIso:"2026-10-11T13:30:00Z",teamCode:"JAC",opponentCode:"PHI",providerFetchedAt:"2026-10-10T12:08:00Z"}
  ]};
  const games=[
    {id:"canonical-1",start:"2026-10-11T13:30Z",home_abbr:"JAX",away_abbr:"PHI"},
    {id:"duplicate-2",start:"2026-10-11T13:30Z",home_abbr:"JAX",away_abbr:"PHI"}
  ];
  const result=auditFreeNflMirror(feed,{canonicalGames:games,asOf:"2026-10-10T16:08:00Z"});
  assert.equal(result.sixMarketRows,2);
  assert.equal(result.publishedCount,3);
  assert.equal(result.byMarket.passing_yards,1);
  assert.equal(result.byMarket.receiving_yards,1);
  assert.equal(result.canonicalIdentityGameCounts.ambiguous,1);
  assert.equal(result.canonicalIdentityRowCounts.ambiguous,2);
  assert.equal(result.rightsReviewRequired,true);
  assert.equal(result.researchOnly,true);
  assert.equal(result.evidenceEligible,false);
  assert.equal(result.canQualify,false);
  assert.equal(result.canAuthorizeWager,false);
  assert.equal(result.canCreateStateSnapshots,false);
  assert.equal(result.dataPersisted,false);
  assert.equal(result.providerCostUsd,0);
  assert.equal(result.sourceTimeValid,true);
  assert.equal(result.sourceAgeHours,4);
});

test("free mirror research audit fails closed for bad timestamps, missing lines and unmatched games",async()=>{
  const {auditFreeNflMirror}=await import("../scripts/audit-free-prop-mirror.mjs");
  const data={sport:"NFL",scrapedAt:"2026-10-10T12:00:00Z",collectionStatus:{ok:false},props:[
    {projectionId:"x",playerId:"1",stat:"Rush Yards",line:"",gameId:"g",startTimeIso:"not-a-time",teamCode:"LA",opponentCode:"BUF"},
    {projectionId:"x",playerId:"1",stat:"Receptions",line:"5.5",gameId:"h",startTimeIso:"2026-10-11T13:00Z",teamCode:"GB",opponentCode:"CHI"}
  ]};
  const report=auditFreeNflMirror(data,{canonicalGames:[]});
  assert.equal(report.sixMarketRows,2);
  assert.equal(report.invalidGameStart,1);
  assert.equal(report.malformedLines,1);
  assert.equal(report.missingSourceObservedAt,2);
  assert.equal(report.duplicateProjectionIds,1);
  assert.equal(report.canonicalIdentityGameCounts.invalid,1);
  assert.equal(report.canonicalIdentityGameCounts.unmatched,1);
  assert.equal(report.sourceTimeValid,false);
  assert.equal(report.collectionStatusOk,false);
  assert.equal(report.canAuthorizeWager,false);
  assert.throws(()=>auditFreeNflMirror({sport:"NFL",props:{}},{}),/NFL mirror props/);
});

test("free mirror audit has no network, provider launch, D1 or qualification side effects",()=>{
  const code=fs.readFileSync("scripts/audit-free-prop-mirror.mjs","utf8");
  assert.doesNotMatch(code,/\bfetch\s*\(|\baxios\b|\bwrangler\b|\.prepare\s*\(|\bDB\.|\bARCHIVE\.|\bINSERT\b|\bUPDATE\b/);
  assert.match(code,/canAuthorizeWager:false/);
  assert.match(code,/canCreateStateSnapshots:false/);
  assert.match(code,/rightsReviewRequired:true/);
});

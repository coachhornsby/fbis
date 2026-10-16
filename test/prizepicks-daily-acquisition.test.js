import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("exactly one free PrizePicks mirror remains scheduled and paid acquisition is retired",()=>{
 const paid=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
 const free=fs.readFileSync(".github/workflows/free-prizepicks-mirror.yml","utf8");
 assert.match(paid,/RETIRED/);
 assert.doesNotMatch(paid,/^  schedule:/m);
 assert.equal((free.match(/cron:/g)||[]).length,0,"unscoped free mirror pulls are paused");
 assert.match(free,/FREE_PRIZEPICKS_MIRROR_INGESTION_DISABLED/);
 assert.ok(free.includes("No mirror HTTP fetch"));
 assert.doesNotMatch(free,/APIFY_TOKEN|api\/apify-acquire/);
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

test("historical PrizePicks schema remains readable but new acquisition is blocked",()=>{
 const workflow=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
 const api=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
 assert.match(workflow,/RETIRED/);
 assert.match(api,/retiredOddsCollectorResponse\("PRIZEPICKS_APIFY"\)/);
 assert.match(api,/prizepicks_daily_acquisitions/);
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


test("free NFL mirror accepts only today's pregame standard source lines without any betting authority",async()=>{
  const {normalizeFreeNflMirror,mirrorChicagoDay}=await import("../src/features/playerProps/freePrizePicksMirror.js");
  const now="2026-10-11T13:31:00.000Z";
  assert.equal(mirrorChicagoDay(now),"2026-10-11");
  const row=(id,overrides={})=>({
    projectionId:id,playerId:"p"+id,player:"Example Player",Team:"New England Patriots",
    Opponent:"Las Vegas Raiders",teamCode:"NE",opponentCode:"LV",
    gameId:"186658",stat:"Pass Yards",line:"204.5",sport:"NFL",status:"pre_game",
    oddsType:"standard",startDateCST:"2026-10-11",startTimeIso:"2026-10-11T13:00:00.000-04:00",
    providerFetchedAt:"2026-10-11T12:08:00.000Z",...overrides,
  });
  const feed={sport:"NFL",scrapedAt:"2026-10-11T12:09:39.506Z",
    collectionStatus:{ok:true,providerFetchedAt:"2026-10-11T12:08:00.000Z"},
    props:[
      row("valid"),
      row("started",{startTimeIso:"2026-10-11T09:30:00.000-04:00"}),
      row("tomorrow",{startDateCST:"2026-10-12",startTimeIso:"2026-10-12T13:00:00.000-04:00"}),
      row("discount",{oddsType:"goblin"}),
      row("null",{line:""}),
      row("dup",{stat:"Receptions",line:"5.5"}),
      row("dup",{stat:"Receptions",line:"5.5"}),
    ]};
  const report=normalizeFreeNflMirror(feed,{now:new Date(now)});
  assert.equal(report.ok,true);
  assert.equal(report.rows.length,2);
  assert.equal(report.coreRows,2);
  assert.equal(report.excludedStarted,1);
  assert.equal(report.excludedOtherDate,1);
  assert.equal(report.excludedInvalid,3);
  assert.ok(report.rows.every(x=>x.researchOnly&&x.canQualify===false&&x.canAuthorizeWager===false));
  assert.ok(report.rows.every(x=>x.canonicalEventId===null&&x.evidenceEligible===false&&x.canCreateStateSnapshots===false));
  assert.equal(report.rows[0].source,"THIRD_PARTY_GITHUB_MIRROR");
});

test("free NFL mirror refuses prior-day, post-publication, or stale source data",async()=>{
  const {normalizeFreeNflMirror}=await import("../src/features/playerProps/freePrizePicksMirror.js");
  const feed={sport:"NFL",props:[],scrapedAt:"2026-10-10T12:09:00Z",
    collectionStatus:{ok:true,providerFetchedAt:"2026-10-10T12:08:00Z"}};
  const now=new Date("2026-10-11T15:00:00Z");
  const old=normalizeFreeNflMirror(feed,{now});
  assert.equal(old.ok,false);assert.equal(old.error,"MIRROR_NOT_TODAY");
  const future=normalizeFreeNflMirror({...feed,scrapedAt:"2026-10-11T15:05:00Z",
    collectionStatus:{ok:true,providerFetchedAt:"2026-10-11T16:00:00Z"}},{now});
  assert.equal(future.ok,false);assert.equal(future.error,"MIRROR_TIME_INTEGRITY_FAILED");
  const invalid=normalizeFreeNflMirror({sport:"NFL",props:{}},{now});
  assert.equal(invalid.ok,false);assert.equal(invalid.error,"MIRROR_SCHEMA_INVALID");
  for(const x of [old,future,invalid]){
    assert.equal(x.canQualify,false);assert.equal(x.canAuthorizeWager,false);
    assert.equal(x.evidenceEligible,false);assert.deepEqual(x.rows,[]);
  }
});

test("free NFL board stays separate from paid acquisition and main model pipeline",()=>{
  const panel=fs.readFileSync("src/features/playerProps/PrizePicksMarketPanel.jsx","utf8");
  const board=fs.readFileSync("src/features/playerProps/FreePrizePicksMirrorBoard.jsx","utf8");
  const normalize=fs.readFileSync("src/features/playerProps/freePrizePicksMirror.js","utf8");
  assert.match(panel,/localSport==="nfl"\|\|localSport==="top25"/);
  assert.match(panel,/<FreePrizePicksMirrorBoard\/>/);
  assert.match(board,/No FBIS pick, star rating, or wagering authority/);
  assert.match(board,/sourceUrl|FREE_NFL_MIRROR_SOURCE_URL/);
  assert.match(normalize,/MIRROR_NOT_TODAY/);
  assert.match(normalize,/excludedStarted/);
  assert.match(normalize,/evidenceEligible:false/);
  assert.doesNotMatch(normalize,/\bfetch\s*\(|\bPOST\b|\bINSERT\b|\.prepare\s*\(/);
  assert.doesNotMatch(board,/api\/prizepicks-props|api\/apify-acquire/);
});

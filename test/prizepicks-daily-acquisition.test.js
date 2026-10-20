import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Zen PrizePicks uses the single budgeted acquisition owner and the free mirror stays paused",()=>{
 const paid=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
 const free=fs.readFileSync(".github/workflows/free-prizepicks-mirror.yml","utf8");
 assert.match(paid,/PRIZEPICKS_COLLECTOR_RETIRED/);
 assert.doesNotMatch(paid,/cron:/);

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

test("Zen ingestion requires immutable owned capture and retains historical schema",()=>{
 const workflow=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
 const api=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
 assert.match(workflow,/PRIZEPICKS_COLLECTOR_RETIRED/);
 assert.match(api,/immutable_capture_required/);
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
  assert.match(panel,/data-pp-card=\"prizepicks\"|PrizePicksPropCard|pp-card-last5|LAST 5/);
  assert.match(panel,/resolvedHeadshot|player-image|pp-premium-headshot/);
  assert.match(panel,/PP LINE|fbis_projection|LastFiveBars/);
  assert.doesNotMatch(panel,/<FreePrizePicksMirrorBoard/);
  assert.doesNotMatch(panel,/<ZenPrizePicksLines/);
  assert.match(board,/No FBIS pick, star rating, or wagering authority/);
  assert.match(board,/sourceUrl|FREE_NFL_MIRROR_SOURCE_URL/);
  assert.match(normalize,/MIRROR_NOT_TODAY/);
  assert.match(normalize,/excludedStarted/);
  assert.match(normalize,/evidenceEligible:false/);
  assert.doesNotMatch(normalize,/\bfetch\s*\(|\bPOST\b|\bINSERT\b|\.prepare\s*\(/);
  assert.doesNotMatch(board,/api\/prizepicks-props|api\/apify-acquire/);
});

test('shared PrizePicks scope covers every FBIS sport without an NFL team filter',async()=>{
 const {PRIZEPICKS_FBIS_SPORTS,sharedPrizePicksInput}=await import('../functions/lib/propMarketPolicy.js');
 const {SPORTS}=await import('../functions/lib/slateEngineCore.js');
 assert.deepEqual([...PRIZEPICKS_FBIS_SPORTS].sort(),Object.keys(SPORTS).sort());
 const input=sharedPrizePicksInput(['event-1','event-1']);
 assert.equal(input.leagues.length,10);assert.equal(input.extraLeagues,'NPB');
 for(const league of ['NFL','CFB','NBA','WNBA','College Basketball','MLB','NHL','Tennis','Soccer','KBO'])assert.ok(input.leagues.includes(league),league);
 assert.equal(input.teams,undefined);assert.ok(!input.leagues.includes('All'));
 assert.ok(input.statTypes.includes('Pass Completions'));assert.ok(input.statTypes.includes('Pitcher Strikeouts'));
 assert.deepEqual(input.projectedEventIds,['event-1']);assert.deepEqual(input.oddsTiers,['standard','goblin','demon']);
});
test('daily consumption loads each sport model and isolates a failed model',async()=>{
 const {loadPrizePicksCandidates}=await import('../scripts/restore-zen-prizepicks.mjs');
 const called=[];const out=await loadPrizePicksCandidates(async(sport,date)=>{called.push(sport);assert.equal(date,'2026-10-20');if(sport==='nba')throw Error('model unavailable');return {games:[{id:sport+'1',start:'2026-10-21T00:00:00Z',playerProjectionRows:[{playerName:'Player',market:'points',fbisProjection:3},{playerName:'Missing',fbisProjection:null}]}]};},'2026-10-20');
 assert.equal(called.length,11);assert.equal(new Set(called).size,11);assert.equal(out.candidates.length,10);assert.equal(out.failures[0].sport,'nba');assert.ok(out.candidates.some(c=>c.sport==='nhl'&&c.eventId==='nhl1'));assert.ok(out.candidates.every(c=>c.start));
});
test('all-sports ingestion retains Asian baseball identity and rejects wrong-event projection matches',async()=>{
 const {sportOf,candidateMatchesProp}=await import('../functions/api/prizepicks-props.js');
 assert.equal(sportOf({league:'KBO'}),'kbo');assert.equal(sportOf({league:'Nippon Professional Baseball'}),'npb');assert.equal(sportOf({league:'College Basketball'}),'cbb');assert.equal(sportOf({league:'WNBA'}),'wnba');
 const candidate={start:'2026-10-21T00:00:00Z'};
 assert.equal(candidateMatchesProp(candidate,{start_time:'2026-10-20T20:00:00-04:00'}),true);
 assert.equal(candidateMatchesProp(candidate,{start_time:'2026-10-28T00:00:00Z'}),false);
 assert.equal(candidateMatchesProp(candidate,{}),false);
});

test('immutable mixed-sport consumption preserves model holds and leaves later games unprojected',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {onRequestPost}=await import('../functions/api/prizepicks-props.js');
 const db=new DatabaseSync(':memory:');
 const columns=['id','run_id','projection_id','fbis_event_id','sport','league','player_id','player_name','player_headshot_url','team','opponent','game_id','start_time','stat_type','canonical_market','line','odds_tier','duration','fbis_projection','fbis_sigma','delta_fbis_minus_line','candidate_side','observed_at','collected_at','raw_json','model_source','model_version','role_confidence','snap_share','prop_gate','eligible_for_card','feature_evidence_json'];
 db.exec('CREATE TABLE prizepicks_prop_lines('+columns.join(',')+')');
 const start=new Date(Date.now()+3600000).toISOString();
 const rows=[{league:'MLB',player_name:'Pitcher',stat:'Pitcher Strikeouts',line:4.5,start_time:start},{league:'NHL',player_name:'Skater',stat:'Shots On Goal',line:2.5,start_time:new Date(Date.now()+8*86400000).toISOString()}];
 const source={id:'owned',raw_key:'raw',captured_at:new Date().toISOString()};
 const DB={prepare(sql){const statement={args:[],bind(...args){this.args=args;return this},async first(){return sql.includes('external_acquisitions')?source:null},async all(){return {results:[]}},async run(){return {meta:{changes:1}}},sql};return statement},async batch(statements){return statements.map(s=>({meta:{changes:Number(db.prepare(s.sql).run(...s.args).changes)}}))}};
 const response=await onRequestPost({env:{DB,HARVEST_SECRET:'test',ARCHIVE:{get:async()=>({json:async()=>({rows})})}},request:new Request('https://test/api/prizepicks-props',{method:'POST',headers:{'x-harvest-secret':'test','content-type':'application/json'},body:JSON.stringify({runId:'shared',acquisitionId:'owned',batchIndex:0,rows,candidates:[{sport:'mlb',playerName:'Pitcher',market:'strikeouts',start,fbisProjection:6,fbisSigma:2,propGate:'HOLD',eligibleForCard:false,featureEvidence:{starterConfirmed:false}},{sport:'nhl',playerName:'Skater',market:'shots',start,fbisProjection:4}]})})});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.written,2);assert.equal(result.matched,1);
 const pitcher=db.prepare("SELECT * FROM prizepicks_prop_lines WHERE sport='mlb'").get();assert.equal(pitcher.fbis_projection,6);assert.equal(pitcher.eligible_for_card,0);assert.equal(pitcher.prop_gate,'HOLD');assert.deepEqual(JSON.parse(pitcher.feature_evidence_json),{starterConfirmed:false});
 assert.equal(db.prepare("SELECT fbis_projection FROM prizepicks_prop_lines WHERE sport='nhl'").get().fbis_projection,null);db.close();
});

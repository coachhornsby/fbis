import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapKalshiPlayerContract} from '../functions/lib/propProviderAdapters.js';
import {historySummary,loadCanonicalPropHistory,gradeFrozenProp} from '../functions/lib/propHistoryResearch.js';
import {independentPropRows,joinIndependentPropModels} from '../functions/lib/propResearchData.js';
import {evaluatePropEconomics,equivalentPropContracts} from '../functions/lib/propEconomics.js';
import {captureKalshiPlayerProps} from '../functions/lib/kalshiPlayerPropCollector.js';
const market=JSON.parse(fs.readFileSync('test/fixtures/props/kalshi-nba-live-capture-20261020.json')).markets[0];
const game={id:'fixture-1',sport:'nba',home_abbr:'SA',away_abbr:'OKC',home_name:'San Antonio Spurs',away_name:'Oklahoma City Thunder',start:'2026-10-21T01:30:00Z'};
const player={sport:'nba',player_name:'Victor Wembanyama',player_id:'5104157',team_key:'SA'};
const map=(m=market,opts={})=>mapKalshiPlayerContract(m,{seriesTicker:'KXNBAPTS',games:[game],players:[player],capturedAt:'2026-10-20T14:00:00Z',...opts});
test('real provider capture maps 35+ to 34.5 with exact fixture, roster and provider player ID',()=>{
 const r=map();assert.equal(r.line,34.5);assert.equal(r.trigger,35);assert.equal(r.canonicalEventId,game.id);assert.equal(r.canonicalPlayerId,'nba:espn:5104157');assert.equal(r.dnpSettlement,'FAIR_PRICE');assert.equal(r.identityVerified,true);
 assert.equal(r.observedAsk,.19);assert.equal(r.observedAt,null);assert.equal(r.purchaseAsk,null);assert.equal(r.canQualify,false);assert.equal(r.canAuthorizeWager,false);
});
test('wrong date/team, duplicate fixture, missing player ID and wrong stat cannot map',()=>{
 for(const opts of [{games:[{...game,start:'2026-10-22T01:30:00Z'}]},{games:[{...game,home_abbr:'BOS',home_name:'Boston Celtics'}]},{games:[game,{...game,id:'duplicate'}]},{players:[]},{players:[player,{...player,player_id:'duplicate'}]}])assert.equal(map(market,opts).rejected,true);
 assert.equal(map({...market,custom_strike:{}}).rejected,true);
 assert.equal(map({...market,rules_primary:market.rules_primary.replace('points in','rebounds in')}).rejected,true);
 assert.equal(map({...market,floor_strike:35}).rejected,true);
});
test('history excludes future/current-day unknown finals, missing and DNP, retains official zero; splits and medians use verified rows',()=>{
 const games=[{eventId:'a',date:'2026-10-18',value:0,isHome:true},{eventId:'b',date:'2026-10-19',value:10,isHome:false},{eventId:'c',date:'2026-10-19',value:null},{eventId:'d',date:'2026-10-20',value:99},{eventId:'e',date:'2026-10-21',value:88},{eventId:'f',date:'2026-10-17',value:0,status:'DNP'}];
 const h=historySummary(games,{asOf:'2026-10-20T14:00:00Z',line:5});assert.equal(h.games.length,2);assert.equal(h.recent5.average,5);assert.equal(h.recent5.median,5);assert.equal(h.splits.home.average,0);assert.equal(h.splits.away.average,10);assert.equal(h.thresholdBasis,'CURRENT_THRESHOLD_RETROACTIVE');assert.equal(h.calibratedProbability,null);
});
test('NBA policy block stays closed even with a valid athlete ID',async()=>{
 let called=false;const r=await loadCanonicalPropHistory({}, {sport:'nba',provider:'espn',playerId:'5104157',market:'points',fetchImpl:()=>{called=true;}});assert.equal(called,false);assert.equal(r.reason,'NBA_RIGHTS_CLEARED_PLAYER_FEED_REQUIRED');
});
test('NHL canonical player endpoint yields real zeros and omits DNP without name search',async()=>{
 const r=await loadCanonicalPropHistory({}, {sport:'nhl',provider:'nhl',playerId:'123',market:'shots_on_goal',asOf:'2026-10-20T14:00:00Z',fetchImpl:async url=>{assert.match(String(url),/\/player\/123\/game-log\/now/);return Response.json({playerId:123,seasonId:20262027,gameLog:[{gameId:1,gameDate:'2026-10-19',shots:0,toi:'14:00',opponentAbbrev:'BOS'},{gameId:2,gameDate:'2026-10-18',shots:null,toi:'0:00'}]});}});
 assert.equal(r.available,true);assert.equal(r.last5[0].value,0);assert.equal(r.canonicalPlayerId,'nhl:nhl:123');
});
test('independent models cannot join another player/event or provider namespace',()=>{
 const model={id:'m',canonicalEventId:'e',canonicalPlayerId:'nfl:nflverse:1',canonical_market:'receiving_yards',period:'full_game',fbis_projection:75};
 const contract={id:'c',canonicalEventId:'e',canonicalPlayerId:'nfl:espn:1',canonical_market:'receiving_yards',period:'full_game',line:60,reasons:[]};
 assert.equal(joinIndependentPropModels([contract],[model]).length,2);
 const joined=joinIndependentPropModels([{...contract,canonicalPlayerId:model.canonicalPlayerId}],[model]);assert.equal(joined.length,1);assert.equal(joined[0].fbis_projection,75);
 assert.equal(independentPropRows({games:[{start:'2026-10-21T00:00:00Z',playerProjectionRows:[{playerId:'1',fbisProjection:2,independent:false}]}]},{now:0}).length,0);
});
test('fees, identity, settlement and calibration all gate expected return',()=>{
 const c={identityVerified:true,canonicalEventId:'e',canonicalPlayerId:'p',canonical_market:'points',period:'full_game',line:20.5,side:'yes',settlementTerms:'same rules',fresh:true,priceVerified:true,purchaseAsk:.5};const m={...c,calibrated:true,modelVersion:'v1',probability:.6};
 assert.equal(evaluatePropEconomics(c,m,{verified:true,perContract:.01}).supported,true);assert.ok(Math.abs(evaluatePropEconomics(c,m,{verified:true,perContract:.01}).expectedProfitPerContract-.09)<1e-9);
 assert.equal(evaluatePropEconomics(c,m,{}).supported,false);assert.equal(evaluatePropEconomics(c,{...m,calibrated:false},{verified:true,perContract:0}).supported,false);
 assert.equal(equivalentPropContracts({...c,statSide:'over',settlementScope:'full',dnpSettlement:'FAIR_PRICE'},{...c,statSide:'over',settlementScope:'full',dnpSettlement:'VOID'}),false);
});
test('grading requires official actual and pregame frozen prediction; never creates profit or a wager',()=>{
 const prediction={eventStart:'2026-10-20T23:00:00Z',frozenAt:'2026-10-20T20:00:00Z',projection:30};assert.equal(gradeFrozenProp({prediction,actual:35}).graded,false);
 const r=gradeFrozenProp({prediction,actual:35,officialVerified:true,contract:{kind:'binary',threshold:34.5,statSide:'over'}});assert.equal(r.contractResult,'WON');assert.equal(r.forecastError,-5);assert.equal(r.recordedWager,false);assert.equal(r.wagerProfit,null);
});
test('collector fails closed without archive and limits discovery to actual catalog series',async()=>{
 assert.equal((await captureKalshiPlayerProps({})).code,'ARCHIVE_BINDING_MISSING');
 const files=new Map([['kalshi/public-shadow/v1/series-catalog.json',{ok:true,records:[]}]]);const env={ARCHIVE:{get:async k=>files.has(k)?{json:async()=>files.get(k)}:null,put:async(k,v)=>files.set(k,JSON.parse(v))}};
 let fetched=false;const r=await captureKalshiPlayerProps(env,{fetchImpl:()=>{fetched=true;}});assert.equal(fetched,false);assert.equal(r.discoveredSeries,0);
});
test('real NHL rule identifies its league and cannot be relabeled as NBA',()=>{
 const m=JSON.parse(fs.readFileSync('test/fixtures/props/kalshi-nhl-live-capture-20261020.json')).markets[0];
 const mapped=mapKalshiPlayerContract(m,{seriesTicker:'KXNHLPTS',capturedAt:'2026-10-20T14:00:00Z',games:[{id:'nhl-1',sport:'nhl',away_abbr:'DET',home_abbr:'SEA',away_name:'Detroit Red Wings',home_name:'Seattle Kraken',start:'2026-10-21T02:00:00Z'}],players:[{sport:'nhl',player_name:'Mackie Samoskevich',player_id:'8482713',team_key:'sea'}]});
 assert.equal(mapped.canonicalPlayerId,'nhl:nhl:8482713');assert.equal(mapped.line,1.5);assert.equal(mapped.identityVerified,true);assert.equal(mapped.dnpSettlement,'ACTIVE_NO_APPEARANCE_LAST_FAIR_PRICE');
 assert.equal(map({...market,rules_primary:market.rules_primary.replace('Pro Basketball','NFL')}).reason,'LEAGUE_DEFINITION_MISMATCH');
});
test('current-slate fixture read excludes legacy synthetic rows from older board dates',async()=>{
 const {loadPropFixturesAndPlayers}=await import('../functions/lib/propResearchData.js');
 const calls=[];const db={prepare(sql){return{bind(...args){calls.push({sql,args});return {all:async()=>({results:[]})};},all:async()=>({results:[]})};}};
 await loadPropFixturesAndPlayers({DB:db},{start:'2026-10-20T05:00:00Z',end:'2026-10-21T05:00:00Z',sport:'nba'});
 const fixture=calls.find(c=>c.sql.includes('FROM games'));assert.match(fixture.sql,/AND date=\?/);assert.equal(fixture.args[2],'2026-10-20');
});

test('PRA model alias joins only exact independent player, event and period',()=>{
 const c={id:'k',canonicalEventId:'g-1',canonicalPlayerId:'nba:espn:12',canonical_market:'points_rebounds_assists',period:'full_game',line:39.5,reasons:['MODEL_UNAVAILABLE']};
 const p={id:'m',canonicalEventId:'g-1',canonicalPlayerId:'nba:espn:12',canonical_market:'pra',period:'full_game',fbis_projection:34,independent:true,modelStatus:'RESEARCH_PROJECTION'};
 const good=joinIndependentPropModels([c],[p]);
 assert.equal(good.length,1);assert.equal(good[0].fbis_projection,34);
 assert.equal(good[0].projectionDelta,-5.5);
 for(const changed of [{canonicalPlayerId:'nba:espn:13'},{canonicalEventId:'g-2'},{period:'first_half'},{independent:false}]){
  const out=joinIndependentPropModels([c],[{...p,...changed}]);
  assert.equal(out[0].fbis_projection,undefined);
 }
});

test('persisted ESPN/GSIS roster links join an NFL model without guessing from player name',async()=>{
 const {resolvePropModelIdentities}=await import('../functions/lib/propResearchData.js');
 const model={sport:'nfl',canonicalEventId:'G',canonicalPlayerId:'nfl:nflverse:00-0039918',historyProvider:'nflverse',historyPlayerId:'00-0039918',team:'CHI',fbis_projection:226.2,canonical_market:'passing_yards',period:'full_game',independent:true};
 const roster={sport:'nfl',player_id:'4431611',team_key:'chi',player_name:'Caleb Williams',raw_json:JSON.stringify({roster:{id:'4431611'},usage:{id:'00-0039918',team:'CHI'}})};
 const context={games:[{id:'G',home_abbr:'CHI',away_abbr:'NE'}],players:[roster]};
 const resolved=resolvePropModelIdentities([model],context)[0];
 assert.equal(resolved.canonicalPlayerId,'nfl:espn:4431611');assert.equal(resolved.historyPlayerId,'4431611');assert.equal(resolved.modelPlayerId,model.canonicalPlayerId);
 const contract={canonicalEventId:'G',canonicalPlayerId:'nfl:espn:4431611',canonical_market:'passing_yards',period:'full_game',line:249.5,reasons:['MODEL_UNAVAILABLE']};
 assert.equal(joinIndependentPropModels([contract],[resolved])[0].fbis_projection,226.2);
 for(const players of [[{...roster,raw_json:'{}'}],[{...roster,team_key:'NE'}],[roster,{...roster,player_id:'different',raw_json:JSON.stringify({roster:{id:'different'},usage:{id:'00-0039918',team:'CHI'}})}]]){
  assert.equal(resolvePropModelIdentities([model],{...context,players})[0].canonicalPlayerId,model.canonicalPlayerId);
 }
});
test('ESPN dictionary metadata joins exact season stat rows and preserves missing stats and true zero',async()=>{
 const {espnPropHistoryGames}=await import('../functions/lib/propHistoryResearch.js');
 const b={names:['passingYards','rushingYards'],events:{a:{id:'a',gameDate:'2026-10-18T17:00Z',gameResult:'W',atVs:'@',opponent:{abbreviation:'ATL'}},b:{id:'b',gameDate:'2026-10-11T17:00Z',gameResult:'L'},c:{id:'c',gameDate:'2026-10-04T17:00Z',gameResult:'W'}},seasonTypes:[{categories:[{events:[{eventId:'a',stats:['305','3']},{eventId:'b',stats:['0','10']},{eventId:'c',stats:['--','20']}]}]}]};
 const games=espnPropHistoryGames(b,{sport:'nfl',market:'passing_yards',season:2026});
 assert.deepEqual(games.map(g=>g.value),[305,0,null]);assert.equal(games[0].opponent,'ATL');
 const h=historySummary(games,{asOf:'2026-10-22T12:00Z'});assert.equal(h.games.length,2);assert.equal(h.recent5.average,152.5);
});

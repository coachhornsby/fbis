import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapKalshiPlayerContract} from '../functions/lib/propProviderAdapters.js';
import {historySummary,loadCanonicalPropHistory,gradeFrozenProp} from '../functions/lib/propHistoryResearch.js';
import {independentPropRows,joinIndependentPropModels} from '../functions/lib/propResearchData.js';
import {evaluatePropEconomics,equivalentPropContracts} from '../functions/lib/propEconomics.js';
import {captureKalshiPlayerProps} from '../functions/lib/kalshiPlayerPropCollector.js';
test('MLB last five follows postseason appearances across rounds before regular-season games for hitters and pitchers',async()=>{
 const split=(id,date,value)=>({date,game:{gamePk:id},player:{id:123},opponent:{name:'Opponent'},stat:{hits:value,strikeOuts:value,numberOfPitches:85,plateAppearances:4}});
 const regular=[split(1,'2026-09-27',9),split(2,'2026-09-28',8)];
 const playoffs=[split(3,'2026-10-02',0),split(4,'2026-10-07',1),split(5,'2026-10-12',2),split(6,'2026-10-17',3),split(7,'2026-10-21',4),split(8,'2026-10-24',99)];
 for(const market of ['hits','strikeouts']){
  const requests=[];
  const h=await loadCanonicalPropHistory({},{sport:'mlb',provider:'mlb',playerId:'123',market,asOf:'2026-10-23T12:00Z',fetchImpl:async url=>{const u=new URL(url);requests.push(u);return Response.json({stats:[{splits:u.searchParams.get('gameType')==='P'?playoffs:regular}]});}});
  assert.equal(h.available,true);assert.deepEqual(h.last5.map(g=>g.eventId),['7','6','5','4','3']);assert.deepEqual(h.last5.map(g=>g.value),[4,3,2,1,0]);
  assert.deepEqual(requests.map(u=>u.searchParams.get('gameType')).sort(),['P','R']);
  assert.ok(requests.every(u=>u.searchParams.get('group')===(market==='hits'?'hitting':'pitching')));
 }
});

test('MLB mixes short postseason samples with preceding regular games and refuses a failed playoff feed',async()=>{
 const regular=[1,2,3,4,5].map(n=>({date:`2026-09-${20+n}`,game:{gamePk:n},stat:{hits:n}}));
 const playoff={date:'2026-10-02',game:{gamePk:6},stat:{hits:0}};
 const options={sport:'mlb',provider:'mlb',playerId:'123',market:'hits',asOf:'2026-10-23T12:00Z'};
 const fetchImpl=async url=>Response.json({stats:[{splits:new URL(url).searchParams.get('gameType')==='P'?[playoff,playoff]:regular}]});
 const h=await loadCanonicalPropHistory({}, {...options,fetchImpl});
 assert.deepEqual(h.last5.map(g=>g.eventId),['6','5','4','3','2']);assert.equal(h.last5[0].value,0);
 const failed=await loadCanonicalPropHistory({}, {...options,fetchImpl:async url=>new URL(url).searchParams.get('gameType')==='P'?new Response('',{status:503}):fetchImpl(url)});
 assert.equal(failed.available,false);assert.equal(failed.reason,'VERIFIED_HISTORY_SOURCE_UNAVAILABLE');assert.equal(failed.last5,undefined);
});
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
test('NBA exact athlete history joins dates and stats, excludes preseason/DNP/future, and carries prior regular season',async()=>{
 const requests=[];
 const payload=(season)=>({names:['minutes','totalRebounds','assists','points'],events:{
  current:{gameDate:'2026-10-21T23:00Z',gameResult:'W',opponent:{abbreviation:'MIA'},atVs:'@'},
  pre:{gameDate:'2026-10-15T23:00Z',gameResult:'W'},dnp:{gameDate:'2026-10-20T23:00Z',gameResult:'W'},
  future:{gameDate:'2026-10-24T23:00Z',gameResult:'W'},old:{gameDate:'2026-04-12T23:00Z',gameResult:'L',opponent:{abbreviation:'BOS'}}},
  seasonTypes:[{displayName:season===2027?'2026-27 Regular Season':'2025-26 Regular Season',categories:[{events:season===2027?[{eventId:'current',stats:['33','10','0','45']},{eventId:'dnp',stats:['0','0','0','0']},{eventId:'future',stats:['30','5','8','22']}]:[{eventId:'old',stats:['31','8','5','20']}]}]},
  {displayName:'Preseason',categories:[{events:[{eventId:'pre',stats:['28','0','3','20']}]}]}]});
 const r=await loadCanonicalPropHistory({}, {sport:'nba',provider:'espn',playerId:'4594268',market:'assists',asOf:'2026-10-23T12:00Z',fetchImpl:async url=>{requests.push(String(url));return Response.json(payload(Number(new URL(url).searchParams.get('season'))));}});
 assert.equal(r.available,true);assert.equal(r.identityVerified,true);assert.equal(r.canonicalPlayerId,'nba:espn:4594268');
 assert.deepEqual(r.last5.map(g=>g.value),[0,5]);assert.equal(r.last5[0].opponent,'MIA');assert.equal(r.season.games,1);
 assert.match(requests[0],/athletes\/4594268\/gamelog\?season=2027/);assert.equal(requests.length,2);assert.equal(r.calibratedProbability,null);
});
test('NBA history refuses a non-ESPN or malformed identity without network access',async()=>{
 for(const [provider,playerId] of [['nhl','4594268'],['espn','not-an-id']]){
 const r=await loadCanonicalPropHistory({}, {sport:'nba',provider,playerId,fetchImpl:()=>{throw Error('must not fetch');}});assert.equal(r.available,false);
 }
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

test('stored exact-ID NFL history survives an unavailable external API without inventing dates',async()=>{
 const profile={player_id:'4431611',team_key:'chi',updated_at:'2026-10-21T12:00Z',raw_json:JSON.stringify({roster:{id:'4431611'},usage:{id:'00-0039918',team:'CHI',recentGames:[{season:2026,week:6,opponent:'ATL',stats:{passing_yards:305}},{season:2025,week:18,opponent:'DET',stats:{passing_yards:0}},{season:2025,week:17,opponent:'SF',stats:{passing_yards:null}}]}})};
 const env={DB:{prepare:()=>({bind:()=>({all:async()=>({results:[{event_id:'final',season:2026,week:6,start_time:'2026-10-18T17:00Z',opponent_key:'atl',site:'ROAD'}]})})})}};
 let external=false;const h=await loadCanonicalPropHistory(env,{sport:'nfl',provider:'espn',playerId:'4431611',market:'passing_yards',profile,asOf:'2026-10-22T12:00Z',fetchImpl:()=>{external=true;throw Error('unavailable');}});
 assert.equal(external,false);assert.equal(h.available,true);assert.equal(h.partialSeason,true);assert.deepEqual(h.last5.map(g=>g.value),[305,0]);assert.equal(h.last5[0].isHome,false);assert.equal(h.last5[1].date,null);assert.equal(h.last5[1].week,18);
 const january=historySummary(h.games,{asOf:'2026-01-01T12:00Z'});assert.equal(january.games.length,0);
 const invalid=await loadCanonicalPropHistory(env,{sport:'nfl',provider:'espn',playerId:'wrong-id',market:'passing_yards',profile,asOf:'2026-10-22T12:00Z',fetchImpl:()=>{throw Error('blocked');}});assert.equal(invalid.available,false);
});
test('roster reads scope to fixture teams instead of truncating later teams from the league table',async()=>{
 const {loadPropFixturesAndPlayers}=await import('../functions/lib/propResearchData.js');const queries=[];
 const env={DB:{prepare(sql){return{bind(...args){queries.push({sql,args});return{all:async()=>({results:sql.includes('FROM games')?[{id:'G',sport:'nfl',home_abbr:'CHI',away_abbr:'NE'}]:[]})};}};}}};
 await loadPropFixturesAndPlayers(env,{start:'2026-10-22T05:00Z',end:'2026-10-23T05:00Z',sport:'nfl'});
 const q=queries.find(q=>q.sql.includes('nfl_player_profiles'));assert.ok(q.sql.includes('team_key IN'));assert.ok(q.args.includes('ne'));assert.ok(q.args.includes('chi'));assert.ok(!q.sql.includes('LIMIT 2000'));
});

test('NBA cards use the verified daily archive without relying on an edge upstream request',async()=>{
 const payload={version:1,source:'SDV_ESPN_NBA_PLAYER_BOXSCORES',mode:'SHADOW_RESEARCH_ONLY',authority:'SHADOW_HISTORY_ONLY',seasonType:'NBA_REGULAR_SEASON_ONLY',generatedAt:'2026-10-22T13:00Z',ingestedAt:'2026-10-22T13:01Z',asOfDayExclusive:'2026-10-22',provenance:'https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores',canQualify:false,canAuthorizeWager:false,playerCount:1,entries:[{espnPlayerId:'4594268',games:[{gameId:'401909091',date:'2026-10-21',season:2027,seasonType:2,minutes:33,points:45,rebounds:10,assists:0,three_pointers_made:9,opponent:'MIA',isHome:false}]}]};
 const env={ARCHIVE:{get:async key=>{assert.match(key,/player-history-shadow/);return {json:async()=>payload};}}};
 const h=await loadCanonicalPropHistory(env,{sport:'nba',provider:'espn',playerId:'4594268',market:'pra',asOf:'2026-10-23T12:00Z',fetchImpl:()=>{throw Error('network must not run');}});
 assert.equal(h.available,true);assert.equal(h.last5[0].value,55);assert.equal(h.last5[0].opponent,'MIA');assert.equal(h.historyAsOfDay,'2026-10-22');assert.equal(h.partialSeason,true);assert.equal(h.calibratedProbability,null);
 payload.entries[0].games[0].minutes=0;
 const rejected=await loadCanonicalPropHistory(env,{sport:'nba',provider:'espn',playerId:'4594268',market:'points',asOf:'2026-10-23T12:00Z',fetchImpl:()=>{throw Error('no source');}});assert.equal(rejected.available,false);
});

test('legacy MLB card endpoint requests postseason and sorts combined logs rather than trusting source order',async()=>{
 const {onRequestGet}=await import('../functions/api/player-prop-detail.js');
 const original=globalThis.fetch;const requests=[];
 try{
  globalThis.fetch=async url=>{
   requests.push(new URL(url));
   if(String(url).includes('/people/search'))return Response.json({people:[{id:123,fullName:'Test Player'}]});
   return Response.json({stats:[{type:{displayName:'gameLog'},splits:[
    {game:{gamePk:2},date:'2025-10-15',opponent:{name:'Playoffs'},stat:{hits:0}},
    {game:{gamePk:1},date:'2025-09-28',opponent:{name:'Regular'},stat:{hits:9}},
    {game:{gamePk:3},date:'2025-10-20',opponent:{name:'Playoffs'},stat:{hits:2}}
   ]}]});
  };
  const response=await onRequestGet({env:{},request:new Request('https://fbis.test/api/player-prop-detail?sport=mlb&name=Test%20Player&market=hits')});
  const body=await response.json();assert.equal(body.ok,true);
  assert.deepEqual(body.detail.last5.map(g=>g.date),['2025-10-20','2025-10-15','2025-09-28']);
  assert.equal(requests[1].searchParams.get('gameType'),'R,P');
 }finally{globalThis.fetch=original;}
});

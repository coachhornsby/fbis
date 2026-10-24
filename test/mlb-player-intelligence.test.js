import {topThreeGamePlayerProps} from '../src/features/playerProps/topGamePlayerProps.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mlbInningsToOuts,mlbOutsToInnings,mlbStatValue,normalizeMlbAppearances,mlbScheduleIndex} from '../functions/lib/mlbPlayerHistory.js';
import {loadCanonicalPropHistory} from '../functions/lib/propHistoryResearch.js';
import {normalizeMlbGameFeed,mlbBoxscoreFeatures} from '../functions/lib/mlbGameIntelligence.js';
import {getProTeamDirectory,parseProRoster} from '../functions/lib/proTeamDirectory.js';
const fixture=(id,date,type='R',extra={})=>({gamePk:id,gameDate:date+'T18:00:00Z',officialDate:date,gameType:type,season:2026,status:{abstractGameState:'Final',codedGameState:'F'},teams:{home:{team:{id:147,name:'Yankees'}},away:{team:{id:117,name:'Astros'}}},...extra});
const split=(id,date,value=0,extra={})=>({date,game:{gamePk:id},player:{id:123},team:{id:147},isHome:true,stat:{hits:value,strikeOuts:value,numberOfPitches:80,plateAppearances:4,battersFaced:20},...extra});
const asOf='2026-10-23T12:00:00Z';
test('baseball innings use outs; malformed decimals and missing composite terms stay unavailable',()=>{
 assert.equal(mlbInningsToOuts('5.2'),17);assert.equal(mlbOutsToInnings(17),'5.2');
 for(const v of ['5.3','-1','abc',null])assert.equal(mlbInningsToOuts(v),null);
 assert.equal(mlbStatValue({inningsPitched:'5.2'},'pitcher_outs'),17);
 assert.equal(mlbStatValue({hits:1,runs:0},'hits_runs_rbis'),null);
});
test('all 30 MLB teams have official IDs; duplicate roster players retain a canonical identity',()=>{
 const teams=getProTeamDirectory('mlb');assert.equal(teams.length,30);assert.equal(new Set(teams.map(t=>t.mlbId)).size,30);assert.ok(teams.every(t=>Number.isInteger(t.mlbId)));
 const p={person:{id:123,fullName:'Player'},position:{abbreviation:'RF'}};
 const rows=parseProRoster('mlb',{roster:[p,p]});assert.equal(rows.length,1);assert.equal(rows[0].canonicalPlayerId,'mlb:mlb:123');
});
test('postseason rounds stay separate from regular season; partial postseason is not filled with September',async()=>{
 const gs=[fixture(1,'2026-09-27'),fixture(2,'2026-10-02','F')],ss=[split(1,'2026-09-27',9),split(2,'2026-10-02',0)];
 const requests=[];
 const fetchImpl=async url=>{const u=new URL(url);requests.push(u);return Response.json(u.pathname.endsWith('/schedule')?{dates:[{games:gs}]}:{stats:[{group:{displayName:'hitting'},splits:ss.filter(s=>gs.find(g=>g.gamePk===s.game.gamePk).gameType===u.searchParams.get('gameType'))}]});};
 const h=await loadCanonicalPropHistory({},{sport:'mlb',provider:'mlb',playerId:'123',market:'hits',asOf,fetchImpl});
 assert.equal(h.available,true);assert.equal(h.historyScope,'POSTSEASON');assert.deepEqual(h.last5.map(g=>g.value),[0]);assert.equal(h.last5[0].gameType,'F');assert.equal(h.blendedRecent.last5.length,2);assert.equal(requests.length,6);
 const failed=await loadCanonicalPropHistory({},{sport:'mlb',provider:'mlb',playerId:'123',market:'hits',asOf,fetchImpl:async url=>new URL(url).searchParams.get('gameType')==='D'?new Response('',{status:503}):fetchImpl(url)});
 assert.equal(failed.available,false);
});
test('verified appearances preserve zeros and doubleheaders; reject DNP, null, live, wrong identity and spring',()=>{
 const games=[fixture(1,'2026-10-01','F',{gameNumber:1}),fixture(2,'2026-10-01','F',{gameNumber:2,gameDate:'2026-10-01T23:00:00Z'}),fixture(3,'2026-10-02','D'),fixture(4,'2026-10-03','D'),fixture(5,'2026-10-04','D',{status:{abstractGameState:'Live',codedGameState:'I'}}),fixture(6,'2026-03-03','S'),fixture(7,'2026-10-05','D')];
 const splits=[split(1,'2026-10-01',0),split(1,'2026-10-01',0),split(2,'2026-10-01',2),split(3,'2026-10-02',null),split(4,'2026-10-03',0,{stat:{hits:0,plateAppearances:0}}),split(5,'2026-10-04',9),split(6,'2026-03-03',9),split(7,'2026-10-05',2,{player:{id:999}})];
 const rows=normalizeMlbAppearances(splits,mlbScheduleIndex({dates:[{games}]}),{playerId:'123',market:'hits',asOf});assert.deepEqual(rows.map(r=>r.eventId),['2','1']);assert.equal(rows[1].value,0);
});
test('a historical traded-player record uses game team; current roster is irrelevant',()=>{
 const game=fixture(1,'2026-07-01');const s=split(1,'2026-07-01');
 const rows=normalizeMlbAppearances([s],new Map([['1',game]]),{playerId:'123',market:'hits',asOf});assert.equal(rows[0].teamId,'147');
 assert.equal(normalizeMlbAppearances([{...s,team:{id:117}}],new Map([['1',game]]),{playerId:'123',market:'hits',asOf}).length,0);
});
test('same-day final requires completion timestamp before cutoff',()=>{
 const s=split(1,'2026-10-23'),g=fixture(1,'2026-10-23','W',{gameDate:'2026-10-23T02:00:00Z'});
 assert.equal(normalizeMlbAppearances([s],new Map([['1',g]]),{playerId:'123',market:'hits',asOf}).length,0);
});
test('game normalization preserves pitch-to-PA identities and rejects non-final feed',()=>{
 const feed={
  gameData:{game:{pk:1,type:'W',season:2026},datetime:{officialDate:'2026-10-20',dateTime:'2026-10-20T20:00Z'},status:{abstractGameState:'Final',codedGameState:'F'}},
  liveData:{
   boxscore:{teams:{home:{team:{id:147},players:{ID123:{person:{id:123},stats:{pitching:{inningsPitched:'5.2',battersFaced:20}}}}},away:{team:{id:117},players:{}}}},
   plays:{allPlays:[{about:{atBatIndex:0,inning:1},matchup:{batter:{id:4},pitcher:{id:123}},playEvents:[{isPitch:true,pitchNumber:1,index:0}]}]}
  }
 };
 const result=normalizeMlbGameFeed(feed,{sourceHash:'hash'});assert.equal(result.players[0].stats.outs,17);assert.equal(result.pitches[0].plateAppearance,0);assert.equal(result.pitches[0].pitcherId,'123');
 feed.gameData.status.codedGameState='I';assert.throws(()=>normalizeMlbGameFeed(feed,{sourceHash:'hash'}));
});
test('features exclude data observed after replay cutoff and preserve rate operands',()=>{
 const record={gameId:'1',date:'2026-10-01',observedAt:'2026-10-02',gameType:'R',group:'pitching',stats:{outs:17,earnedRuns:2,hits:4,baseOnBalls:1,strikeOuts:6,battersFaced:21}};
 const h=mlbBoxscoreFeatures([record,{...record,gameId:'2',observedAt:'2026-10-10'}],{asOf:'2026-10-05'});assert.equal(h.sampleGames,1);assert.equal(h.pitcher.ERA.numerator,54);assert.equal(h.pitcher.ERA.denominator,17);assert.equal(h.pitcher.WHIP.value,15/17);assert.equal(h.hitter.AVG.value,null);assert.equal(h.canAuthorizeWager,false);
});

test('MLB Top 3 preserves canonical identity without deriving unsupported hit probability',()=>{
 const game={id:'mlb-1',sport:'mlb',start:'2026-10-24T20:00:00Z',home:{abbr:'NYY'},away:{abbr:'HOU'},playerMarkets:[{canonicalEventId:'mlb-1',canonicalPlayerId:'mlb:mlb:123',playerName:'Player',team:'NYY',marketCanonical:'hits',line:0.5,fbisProjection:1.4,fbisSigma:0.8,modelIndependent:true,provider:'Kalshi',contractId:'contract',observedAsk:0.4,identityVerified:true}]};
 const rows=topThreeGamePlayerProps(game);assert.equal(rows.length,1);assert.equal(rows[0].canonicalPlayerId,'mlb:mlb:123');assert.equal(rows[0].contractId,'contract');assert.equal(rows[0].observedAsk,0.4);assert.equal(rows[0].probabilityOver,null);assert.equal(rows[0].probabilityUnder,null);
});

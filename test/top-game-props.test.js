import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {topThreeGamePlayerProps} from "../src/features/playerProps/topGamePlayerProps.js";

const base=()=>({
  id:"game-100",sport:"nfl",start:"2026-10-11T17:00:00Z",
  home:{abbr:"BUF",name:"Buffalo Bills"},
  away:{abbr:"KC",name:"Kansas City Chiefs"},
  playerMarkets:[],
  playerProjectionRows:[],
});

test("expanded game card chooses top three genuine game-matched independent projections",()=>{
  const g=base();
  g.playerMarkets=[
    {playerName:"QB1",team:"BUF",marketCanonical:"passing_yards",line:249.5,fbisProjection:296,fbisSigma:30,overOdds:-110,underOdds:-105,book:"book-a"},
    {playerName:"WR1",team:"KC",marketCanonical:"receiving_yards",line:65.5,fbisProjection:81.2,fbisSigma:19},
    {playerName:"RB1",team:"BUF",marketCanonical:"rushing_yards",line:58.5,fbisProjection:65.5,fbisSigma:12},
    {playerName:"TE1",team:"KC",marketCanonical:"receptions",line:4.5,fbisProjection:5.1,fbisSigma:2},
  ];
  const original=JSON.stringify(g);
  const rows=topThreeGamePlayerProps(g);
  assert.equal(rows.length,3);
  assert.equal(rows[0].playerName,"QB1");
  assert.ok(rows.every(x=>x.gameId===g.id&&x.canAuthorizeWager===false&&x.decisionEligible===false&&x.canQualify===false));
  assert.ok(rows.every(x=>x.fbisProjection!=null));
  assert.equal(rows[0].displayStatus,"RESEARCH_ONLY");
  assert.equal(rows[0].line,249.5);
  assert.equal(JSON.stringify(g),original);
});
test("does not display unsupported, wrong-event, unrelated team or absent projection as top prop",()=>{
  const g=base();
  g.playerMarkets=[
    {playerName:"Other QB",team:"BUF",marketCanonical:"passing_yards",eventId:"wrong-game",line:250,fbisProjection:270},
    {playerName:"Unknown",team:"LAR",marketCanonical:"receiving_yards",line:54,fbisProjection:67},
    {playerName:"Propless",team:"KC",marketCanonical:"rushing_yards",line:10.5,overOdds:-110},
    {playerName:"Novelty",team:"BUF",marketCanonical:"first_touchdown",line:.5,fbisProjection:.2},
    {playerName:"Independent?",team:"KC",marketCanonical:"passing_yards",line:200,fbisProjection:230,modelIndependent:false},
    {playerName:"Ready",team:"BUF",marketCanonical:"passing_yards",line:200,fbisProjection:215},
  ];
  const rows=topThreeGamePlayerProps(g);
  assert.deepEqual(rows.map(x=>x.playerName),["Ready"]);
});
test("same player/market across books is deduplicated; blocked availability omitted",()=>{
  const g=base();
  g.playerMarkets=[
    {playerName:"Alpha",team:"KC",marketCanonical:"receiving_yards",line:61.5,fbisProjection:81,fbisSigma:10,book:"A"},
    {playerName:"Alpha",team:"KC",marketCanonical:"receiving_yards",line:65.5,fbisProjection:81,fbisSigma:10,book:"B"},
    {playerName:"Beta",team:"BUF",marketCanonical:"rushing_yards",line:40,fbisProjection:80,propGate:"BLOCKED"},
    {playerName:"Gamma",team:"KC",marketCanonical:"receptions",line:4.5,fbisProjection:6.1}
  ];
  const rows=topThreeGamePlayerProps(g);
  assert.equal(rows.length,2);
  assert.deepEqual(new Set(rows.map(x=>x.playerName)),new Set(["Alpha","Gamma"]));
});
test("CFB and CBB models can display real projection-only player props without fabricated lines or probabilities",()=>{
  const cfb={...base(),sport:"cfb",playerMarkets:[],playerProjectionRows:[
    {playerId:"1",playerName:"Texas QB",team:"BUF",market:"passing_yards",fbisProjection:284,fbisSigma:46,independent:true},
    {playerId:"2",playerName:"Chief WR",team:"KC",market:"receiving_yards",fbisProjection:89,independent:true},
    {playerId:"3",playerName:"Chief RB",team:"KC",market:"rushing_yards",fbisProjection:68,independent:true},
    {playerId:"4",playerName:"Another",team:"BUF",market:"passing_yards",fbisProjection:210,independent:true}
  ]};
  const result=topThreeGamePlayerProps(cfb);
  assert.equal(result.length,3);
  assert.ok(result.every(r=>r.displayStatus==="PROJECTION_ONLY" && r.line==null && r.book==null));
  assert.ok(result.every(r=>r.probabilityOver==null&&r.probabilityUnder==null&&r.projectionDelta==null));
  const cbb={...base(),sport:"cbb",playerProjectionRows:[
    {playerId:"p2",playerName:"Guard",team:"BUF",market:"points",fbisProjection:18.5,fbisSigma:4.1},
    {playerId:"p3",playerName:"Big",team:"KC",market:"rebounds",fbisProjection:9.8,fbisSigma:2},
  ]};
  assert.equal(topThreeGamePlayerProps(cbb).length,2);
});
test("frozen schedule fallback contains no invented player props or wagering implication",()=>{
  const g={...base(),durableFallback:{source:"D1_SCHEDULE_PRESTART_SNAPSHOT"},
    playerMarkets:[{playerName:"QB",team:"BUF",market:"passing_yards",fbisProjection:280}]};
  assert.deepEqual(topThreeGamePlayerProps(g),[]);
  assert.deepEqual(topThreeGamePlayerProps({...base(),playerMarkets:[]}),[]);
});

test("legacy PrizePicks rows do not populate game-card top three",()=>{
  const g=base();
  g.playerMarkets=[
    {playerName:"QB1",team:"BUF",marketCanonical:"passing_yards",line:320.5,fbisProjection:250,fbisSigma:30,oddsTier:"demon",book:"PrizePicks"},
    {playerName:"QB1",team:"BUF",marketCanonical:"passing_yards",line:249.5,fbisProjection:250,fbisSigma:30,oddsTier:"standard",book:"PrizePicks"},
    {playerName:"WR1",team:"KC",marketCanonical:"receiving_yards",line:95.5,fbisProjection:70,fbisSigma:18,oddsTier:"goblin",book:"PrizePicks"},
    {playerName:"WR1",team:"KC",marketCanonical:"receiving_yards",line:65.5,fbisProjection:70,fbisSigma:18,oddsTier:"standard",book:"PrizePicks"},
    {playerName:"RB1",team:"BUF",marketCanonical:"rushing_yards",line:58.5,fbisProjection:65.5,fbisSigma:12,oddsTier:"standard",book:"PrizePicks"},
  ];
  const rows=topThreeGamePlayerProps(g);
  assert.equal(rows.length,0);
});

test("TopGameProps all-sport path renders neutral premium cards including tennis",()=>{
  const src=fs.readFileSync("src/features/playerProps/TopGameProps.jsx","utf8");
  assert.match(src,/FBISPlayerPropCard/);
  assert.match(src,/top-game-pp-cards/);
  assert.match(src,/exchange-props-panel pp-premium-page/);
  assert.match(src,/exchange-prop-grid top-game-props-grid/);
  assert.match(src,/STYLE_CARD_SPORTS/);
  assert.match(src,/useStyleCards/);
  assert.match(src,/"tennis"/);
  assert.match(src,/!isPrizePicksRow/);
  assert.doesNotMatch(src,/line: null, provider: null/);
  assert.match(src,/rankedHitCount/);
  assert.doesNotMatch(src,/usePrizePicksCards = sport === "nfl"/);
  const card=fs.readFileSync("src/features/playerProps/FBISPlayerPropCard.jsx","utf8");
  assert.match(card,/pp-team-watermark/);
  assert.match(card,/MARKET/);
  assert.doesNotMatch(card,/PrizePicks line|PP LINE/);
  assert.match(card,/FBIS/);
  assert.match(card,/LastFiveBars|LAST 5/);
  assert.match(card,/pp-premium-headshot/);
  assert.match(card,/#000/);
  assert.match(card,/18%/);
  const board=fs.readFileSync("src/components/board/DecisionBoard.jsx","utf8");
  assert.match(board,/TopGameProps/);
  assert.match(board,/tennis/);
  const css=fs.readFileSync("src/features/playerProps/playerProps.css","utf8");
  assert.match(css,/Black field behind the logo/);
  assert.match(css,/#000 !important/);
});

test('embedded NBA projections retain exact ESPN/event keys for verified last-five history',()=>{
 const g={...base(),sport:'nba',playerProjectionRows:[{playerId:'4594268',playerName:'Anthony Edwards',team:'BUF',market:'assists',fbisProjection:3,independent:true,source:'NBA_PLAYER_PROP_PROJECTIONS_D1'}]};
 const [r]=topThreeGamePlayerProps(g);assert.equal(r.canonicalPlayerId,'nba:espn:4594268');assert.equal(r.canonicalEventId,g.id);assert.equal(r.start_time,g.start);assert.equal(r.opponent,'KC');
});

test("one player cannot occupy multiple game cards even with alternate identities and stats",()=> {
  const g=base();
  g.playerMarkets=[
    {playerName:"Alpha",fbisPlayerId:"42",team:"BUF",marketCanonical:"passing_yards",line:199.5,fbisProjection:240,probabilityOver:.72,probabilityUnder:.28},
    {playerName:"Alpha",providerPlayerId:"different-source",team:"BUF",marketCanonical:"rushing_yards",line:19.5,fbisProjection:35,probabilityOver:.83,probabilityUnder:.17},
    {playerName:"Beta",team:"KC",marketCanonical:"receiving_yards",line:39.5,fbisProjection:51,probabilityOver:.68,probabilityUnder:.32},
    {playerName:"Gamma",team:"BUF",marketCanonical:"receptions",line:3.5,fbisProjection:4.5,probabilityOver:.61,probabilityUnder:.39},
  ];
  const rows=topThreeGamePlayerProps(g);
  assert.deepEqual(rows.map(r=>r.playerName),["Alpha","Beta","Gamma"]);
  assert.equal(rows[0].marketCanonical,"rushing_yards");
});

test("highest comparable hit probabilities outrank unpriced projections",()=> {
  const g=base();
  g.playerMarkets=[
    {playerName:"No line",team:"BUF",marketCanonical:"rushing_yards",fbisProjection:150},
    {playerName:"Second",team:"KC",marketCanonical:"receiving_yards",line:55.5,fbisProjection:69,probabilityOver:.75,probabilityUnder:.25},
    {playerName:"First",team:"BUF",marketCanonical:"passing_yards",line:259.5,fbisProjection:290,probabilityOver:.82,probabilityUnder:.18},
    {playerName:"No odds",team:"KC",marketCanonical:"receptions",line:3.5,fbisProjection:5},
  ];
  assert.deepEqual(topThreeGamePlayerProps(g).map(r=>r.playerName),["First","Second","No odds"]);
});

test('verified NBA exchange team aliases SA/GS/NO survive exact game-team lookup',()=>{
 const cases=[
  {away:'SA',home:'DAL',team:'SAS',opp:'DAL'},
  {away:'GS',home:'PHX',team:'GSW',opp:'PHX'},
  {away:'NO',home:'DEN',team:'NOP',opp:'DEN'}
 ];
 for(const c of cases){
  const g={id:'nba-test',sport:'nba',start:'2026-10-24T23:00:00Z',
   home:{abbr:c.home},away:{abbr:c.away},playerProjectionRows:[],
   playerMarkets:[{canonicalEventId:'nba-test',playerName:'Verified player',team:c.team,
    marketCanonical:'points',line:19.5,fbisProjection:24.1,modelIndependent:true,
    book:'Kalshi',provider:'Kalshi',contractId:'kalshi-1'}]};
  const rows=topThreeGamePlayerProps(g);
  assert.equal(rows.length,1,`${c.team} should match verified ESPN team abbreviation`);
  assert.equal(rows[0].line,19.5);
  assert.equal(rows[0].book,'Kalshi');
 }
});

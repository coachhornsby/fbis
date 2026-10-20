import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {wagerMarketDetail} from "../src/lib/wagerMarketDetail.js";

const game={awayIdentity:{abbr:"DAL"},homeIdentity:{abbr:"GB"},finalAwayScore:13,finalHomeScore:23};
test("Historic total shows recorded Under line and verified actual combined score",()=>{
  const d=wagerMarketDetail({...game,market:"TOTAL",period:"FULL_GAME",selectedTeam:"Under 53.5",executionLine:53.5});
  assert.deepEqual(d.wager,{label:"Total",value:"UNDER 53.5"});
  assert.equal(d.score,"DAL 13 – GB 23");
  assert.equal(d.actualTotal,36);
  assert.equal(d.period,"FG");
});

test("Historic over total supports YES contract receipt without confusing price for total",()=>{
  const d=wagerMarketDetail({...game,market:"TOTAL",selectedSide:"YES — Over 50.5 total points 50.5",executionLine:null});
  assert.deepEqual(d.wager,{label:"Total",value:"OVER 50.5"});
  assert.equal(d.actualTotal,36);
});

test("Spread uses the stored spread and keeps zero and plus-handicap formats",()=>{
  const a=wagerMarketDetail({
    market:"SPREAD",period:"FULL_GAME",selectedTeam:"San Francisco 49ers -6.5",
    finalAwayScore:17,finalHomeScore:23,awayTeam:"Washington Commanders",homeTeam:"San Francisco 49ers",
    awayIdentity:{abbr:"WAS"},homeIdentity:{abbr:"SF"}
  });
  assert.deepEqual(a.wager,{label:"Spread",value:"-6.5"});
  assert.equal(a.score,"WAS 17 – SF 23");
  assert.equal(a.actualTotal,null);
  const dog=wagerMarketDetail({market:"SPREAD",selectedTeam:"Arizona Cardinals 12.5",executionLine:12.5});
  assert.deepEqual(dog.wager,{label:"Spread",value:"+12.5"});
  const pk=wagerMarketDetail({market:"SPREAD",selectedTeam:"UNLV PK",executionLine:0});
  assert.deepEqual(pk.wager,{label:"Spread",value:"PK"});
});

test("Missing outcome never invents a final or actual points",()=>{
  const missing=wagerMarketDetail({market:"TOTAL",selectedSide:"Under 44.5",finalAwayScore:0,finalHomeScore:null});
  assert.equal(missing.score,null);
  assert.equal(missing.actualTotal,null);
  assert.deepEqual(missing.wager,{label:"Total",value:"UNDER 44.5"});
  const noLine=wagerMarketDetail({market:"TOTAL",selectedSide:"UNDER"});
  assert.equal(noLine.wager,null);
  const noBadScore=wagerMarketDetail({market:"ML",finalAwayScore:"—",finalHomeScore:23});
  assert.equal(noBadScore.score,null);
});

test("First-five inning totals use F5 actual points, never full-game points",()=>{
  const f5=wagerMarketDetail({
    market:"F5 TOTAL",period:"F5",selectedSide:"Over 4.5",
    awayIdentity:{abbr:"NYY"},homeIdentity:{abbr:"BOS"},
    finalAwayScore:8,finalHomeScore:4,f5AwayScore:2,f5HomeScore:3
  });
  assert.deepEqual(f5.wager,{label:"Total",value:"OVER 4.5"});
  assert.equal(f5.periodScore,"NYY 2 – BOS 3");
  assert.equal(f5.score,"NYY 8 – BOS 4");
  assert.equal(f5.actualTotal,5);
  const notVerified=wagerMarketDetail({...game,market:"F5 TOTAL",selectedSide:"Over 4.5"});
  assert.equal(notVerified.score,"DAL 13 – GB 23");
  assert.equal(notVerified.periodScore,null);
  assert.equal(notVerified.actualTotal,null);
});

test("Non-game props and combos do not show unrelated game score or derived totals",()=>{
  const prop=wagerMarketDetail({...game,market:"PLAYER_PROP",selectedTeam:"Player Under 5.5"});
  assert.equal(prop.score,null);
  assert.equal(prop.wager,null);
  const combo=wagerMarketDetail({...game,market:"3-MARKET COMBO / TOTAL",selectedSide:"Over 49.5"},{combo:true});
  assert.equal(combo.score,null);
  assert.equal(combo.wager,null);
});

test("History Market column renders the validated detail card without losing Side or Final",()=>{
  const view=fs.readFileSync("src/MyBetsView.jsx","utf8");
  const css=fs.readFileSync("src/myBets.css","utf8");
  assert.match(view,/<td className="bets-market-cell"><HistoricalMarket bet=\{b\} combo=\{Boolean\(combo\)\} \/><\/td>/);
  assert.match(view,/<td className=\{combo \? "bets-combo-cell" : undefined\}>/);
  assert.match(view,/<td>\{actualOutcome\(b\)\}<\/td>/);
  assert.match(view,/detail\.actualTotal!=null/);
  assert.match(css,/\.bets-dashboard \.bets-market-bet/);
  assert.match(css,/\.bets-dashboard \.bets-market-actual/);
});

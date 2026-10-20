import test from "node:test";
import assert from "node:assert/strict";
import {bestValuePresentation} from "../src/lib/bestValuePresentation.js";
test("NHL model favorite never converts puck line delta into best wager",()=>{
 const g={sport:"nhl",home:{abbr:"MTL"},away:{abbr:"SJ"},canQualify:false,canAuthorizeWager:false,
 nhlProV2:{ok:true,independent:true,marketInformed:false,probability:{homeWinIncludingOt:.6552}}};
 const vm={sport:"nhl",home:{abbr:"MTL"},away:{abbr:"SJ"},comparison:{sideDiff:.8},
 decision:{evAvailable:false}};
 const v=bestValuePresentation(g,vm);
 assert.equal(v.value,"NO VERIFIED BET");
 assert.match(v.secondary,/MTL ML.*NOT A BET/);
 assert.doesNotMatch(JSON.stringify(v),/0\.8 GOALS DIFFERENCE/);
});
test("even a positive research ROI without qualification cannot produce a betting pick",()=>{
 const g={sport:"nhl",canQualify:false,canAuthorizeWager:false,rec:{pick:"MTL ML",market:"moneyline"}};
 const v=bestValuePresentation(g,{sport:"nhl",decision:{evAvailable:true,ev:8,executionActionable:true,qualification:"QUALIFIED"}});
 assert.equal(v.status,"pass");
});
test("qualified price-supported selection requires explicit wagering and execution authority",()=>{
 const g={sport:"nfl",canQualify:true,canAuthorizeWager:true,rec:{pick:"SEA ML",market:"moneyline"}};
 const d={sport:"nfl",decision:{evAvailable:true,ev:6.2,executionActionable:true,qualification:"QUALIFIED"}};
 const v=bestValuePresentation(g,d);
 assert.equal(v.value,"SEA ML");
 assert.match(v.detail,/6\.2%/);
 assert.equal(v.status,"qualified");
 assert.equal(bestValuePresentation({...g,canAuthorizeWager:false},d).status,"pass");
});
test("non-qualified line gaps never identify a best puck line or total",()=>{
 const v=bestValuePresentation({sport:"nba",market:{spread:5}}, {sport:"nba",comparison:{sideDiff:10,totalDiff:12}});
 assert.equal(v.value,"NO VERIFIED BET");
});

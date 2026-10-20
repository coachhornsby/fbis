import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compareTennisExchangeResearch} from "../functions/lib/tennisExchangeCompare.js";
const players=["Toby Samuel","Zizou Bergs"];
const kalshi=[{yesLabel:"Toby Samuel",yesAskDollars:.47,ticker:"KXATPMATCH-EXAMPLE-SAM",
 fetchedAt:"2026-10-20T15:50:00Z",title:"Toby Samuel vs Zizou Bergs"}];
const polymarket=[{eventSlug:"atp-samuel-bergs-2026-10-20",
 question:"European Open: Toby Samuel vs Zizou Bergs",
 outcomes:["Toby Samuel","Zizou Bergs"],
 researchClob:{observedAt:"2026-10-20T15:49:00Z",sides:[{bestAsk:{price:.45}},{bestAsk:{price:.56}}]}}];
test("same player and match winner quotes compare without issuing betting authority",()=>{
 const data=compareTennisExchangeResearch(players,kalshi,polymarket);
 assert.equal(data.length,1);
 assert.equal(data[0].player,"Toby Samuel");
 assert.equal(data[0].kalshiAsk,.47);
 assert.equal(data[0].polymarketAsk,.45);
 assert.equal(data[0].canAuthorizeWager,false);
 assert.equal(data[0].edgeCalculated,false);
});
test("set winner, absent best ask or mismatched athlete never compare",()=>{
 assert.equal(compareTennisExchangeResearch(players,kalshi,[{...polymarket,question:"Set 1 Winner: Toby Samuel vs Zizou Bergs"}]).length,0);
 assert.equal(compareTennisExchangeResearch(players,[{...kalshi,yesLabel:"Other Person"}],polymarket).length,0);
 assert.equal(compareTennisExchangeResearch(players,kalshi,[{...polymarket,researchClob:{sides:[{},{}]}}]).length,0);
});
test("scheduled signed Kalshi relay authorizes ATP/WTA without changing primary sports rotation",()=>{
 const src=readFileSync(new URL("../services/kalshi-public-collector/index.js",import.meta.url),"utf8");
 assert.match(src,/\[\.\.\.SPORTS,\.\.\.TENNIS_RESEARCH\]\.includes\(sport\)/);
 assert.match(src,/const SPORTS=\["nfl","cfb"\]/);
 assert.match(src,/const TENNIS_RESEARCH=\["atp","wta"\]/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {tennisMarketSnapshot} from "../src/lib/tennisCardPresentation.js";

const payload={
 kalshiResearchOffers:[
  {ticker:"KX-WIN-A",yesLabel:"Kayla Day",yesAskDollars:.51,yesBidDollars:.50},
  {ticker:"KX-WIN-B",yesLabel:"Antonia Ruzic",yesAskDollars:.50,yesBidDollars:.49}
 ],
 polymarketGlobalOffers:[
  {marketId:"winner",question:"Japan Women's Open: Antonia Ruzic vs Kayla Day",outcomes:["Antonia Ruzic","Kayla Day"],indicativePrices:[.505,.495],researchClob:null},
  {marketId:"set-1",question:"Set 1 Winner: Antonia Ruzic vs Kayla Day",outcomes:["Antonia Ruzic","Kayla Day"],indicativePrices:[.35,.65]},
  {marketId:"spread",question:"Game Spread: Antonia Ruzic -3.5",outcomes:["Antonia Ruzic","Kayla Day"],indicativePrices:[.4,.6]},
 ]};
test("scan-first market selection shows only MATCH winner and exactly two source-matched Kalshi sides",()=>{
 const x=tennisMarketSnapshot(payload);
 assert.deepEqual(x.kalshi.map(v=>v.name),["Kayla Day","Antonia Ruzic"]);
 assert.equal(x.polymarket.name,payload.polymarketGlobalOffers[0].question);
 assert.equal(x.otherPolymarketMarkets,2);
 assert.equal(x.polymarket.sides[0].indicative,.505);
 assert.equal(x.polymarket.kind,"INDICATIVE");
 assert.equal(x.comparable,false);
 assert.equal(x.researchOnly,true);
});
test("CLOB ask is not confused with Gamma probability and invalid offers do not turn into 0 cent quotes",()=>{
 const x=tennisMarketSnapshot({
  kalshiResearchOffers:[{yesLabel:"Kayla Day",yesAskDollars:null},{yesLabel:"Antonia Ruzic",yesAskDollars:1.6}],
  polymarketGlobalOffers:[{...payload.polymarketGlobalOffers[0],researchClob:{
   observedAt:"2026-10-21T15:01:00Z",sides:[{bestAsk:{price:.56,size:9}},{bestAsk:null}]
  }}]});
 assert.equal(x.kalshi[0].ask,null);
 assert.equal(x.kalshi[1].ask,null);
 assert.equal(x.polymarket.sides[0].ask,.56);
 assert.equal(x.polymarket.sides[1].ask,null);
 assert.equal(x.polymarket.kind,"CLOB ASK");
});
test("Tennis defaults to compact model-first card; derivative contracts and provenance are progressively disclosed",async()=>{
 const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:"custom"});
 try{
  const {default:TennisMatchCard}=await server.ssrLoadModule("/src/components/board/TennisMatchCard.jsx");
  const game={id:"research-ui",sport:"tennis",tour:"wta",
   away:{name:"Kayla Day",countryCode:"US",rank:119},home:{name:"Antonia Ruzic",countryCode:"HR",rank:91},
   tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.529,player2WinProb:.471,
    tournament:"Kinoshita Group Japan Open",surface:"hard",...payload}};
  const html=renderToStaticMarkup(createElement(TennisMatchCard,{game}));
  const snapshot=html.slice(html.indexOf('class="tmc-market-snapshot"'),html.indexOf('class="tmc-evidence-drawer"'));
  assert.match(snapshot,/EXCHANGE SNAPSHOT/);
  assert.match(snapshot,/KALSHI/);
  assert.match(snapshot,/POLYMARKET.COM/);
  assert.match(snapshot,/50.5%/);
  assert.doesNotMatch(snapshot,/Set 1 Winner|Game Spread/);
  assert.ok(html.indexOf('class="tmc-probability"')<html.indexOf('class="tmc-market-snapshot"'));
  assert.match(html,/class="tmc-evidence-drawer"/);
  assert.match(html,/aria-label="Tennis match intelligence sections"/);
  assert.match(html,/aria-selected="true"/);
  assert.match(html,/Form &amp; surfaces/);
  assert.match(html,/MODEL VS MARKET/);
  assert.match(html,/POLYMARKET.COM · MATCH RESEARCH/);
  const css=readFileSync(new URL("../src/components/board/tennisMatchCard.css",import.meta.url),"utf8");
  assert.match(css,/\.tmc-expanded-body\[data-view="markets"\]/);
  assert.match(css,/@container\(max-width:550px\)/);
 }finally{await server.close();}
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {alignTennisSnapshotSides,tennisMarketSnapshot} from "../src/lib/tennisCardPresentation.js";

test("live Watson/Samsonova market snapshot aligns athlete rows without exchanging provider quotes", () => {
  const snapshot = tennisMarketSnapshot({
    kalshiResearchOffers:[
      {yesLabel:"Heather Watson",yesAskDollars:.14,ticker:"WAT"},
      {yesLabel:"Liudmila Samsonova",yesAskDollars:.87,ticker:"SAM"},
    ],
    polymarketGlobalOffers:[{
      question:"Pan Pacific Open: Liudmila Samsonova vs Heather Watson",
      outcomes:["Liudmila Samsonova","Heather Watson"],
      indicativePrices:[.87,.13],
      researchClob:{sides:[{bestAsk:{price:.88}},{bestAsk:{price:.14}}]},
    }],
  },[],["Heather Watson","Liudmila Samsonova"]);
  assert.deepEqual(snapshot.kalshi.map(o=>o.name),["Heather Watson","Liudmila Samsonova"]);
  assert.deepEqual(snapshot.polymarket.sides.map(o=>o.name),["Heather Watson","Liudmila Samsonova"]);
  assert.deepEqual(snapshot.polymarket.sides.map(o=>o.ask),[.14,.88]);
  assert.deepEqual(snapshot.polymarket.sides.map(o=>o.indicative),[.13,.87]);
  assert.deepEqual(snapshot.kalshi.map(o=>o.ask),[.14,.87]);
  assert.equal(snapshot.comparable,false);
});

test("when Kalshi is reversed too, BOTH columns follow the displayed matchup order",()=>{
  const s=tennisMarketSnapshot({
    kalshiResearchOffers:[
      {yesLabel:"Ann Li",yesAskDollars:.61},
      {yesLabel:"Ashlyn Krueger",yesAskDollars:.41},
    ],
    polymarketGlobalOffers:[{
      question:"Japan Women's Open: Ann Li vs Ashlyn Krueger",
      outcomes:["Ann Li","Ashlyn Krueger"],
      indicativePrices:[.605,.395],
    }],
  },[],["Ashlyn Krueger","Ann Li"]);
  assert.deepEqual(s.kalshi.map(o=>o.name),["Ashlyn Krueger","Ann Li"]);
  assert.deepEqual(s.kalshi.map(o=>o.ask),[.41,.61]);
  assert.deepEqual(s.polymarket.sides.map(o=>o.name),["Ashlyn Krueger","Ann Li"]);
  assert.deepEqual(s.polymarket.sides.map(o=>o.indicative),[.395,.605]);
  assert.equal(s.polymarket.kind,"INDICATIVE");
});

test("provider first-name transliteration aligns by unique surname and initial only",()=>{
  const s=tennisMarketSnapshot({
    kalshiResearchOffers:[
      {yesLabel:"Aliaksandra Sasnovich",yesAskDollars:.58},
      {yesLabel:"Yuliia Starodubtseva",yesAskDollars:.44},
    ],
    polymarketGlobalOffers:[{
      question:"Yulia Starodubtseva vs Aliaksandra Sasnovich",
      outcomes:["Yulia Starodubtseva","Aliaksandra Sasnovich"],
      indicativePrices:[.43,.57],
      researchClob:{sides:[{bestAsk:{price:.44}},{bestAsk:{price:.58}}]},
    }],
  },[],["Aliaksandra Sasnovich","Yuliia Starodubtseva"]);
  assert.deepEqual(s.polymarket.sides.map(o=>o.name),["Aliaksandra Sasnovich","Yulia Starodubtseva"]);
  assert.deepEqual(s.polymarket.sides.map(o=>o.ask),[.58,.44]);
});

test("Polymarket US moneyline observations also align, preserving source and collection classification",()=>{
  const snapshot=tennisMarketSnapshot({},[
    {source:"Polymarket US",marketFamily:"moneyline",participantName:"Ann Li",contractPrice:.61,collectedAt:"2026-10-23T23:50:00Z"},
    {source:"Polymarket US",marketFamily:"moneyline",participantName:"Ashlyn Krueger",contractPrice:.40,collectedAt:"2026-10-23T23:50:00Z"},
  ],["Ashlyn Krueger","Ann Li"]);
  assert.equal(snapshot.polymarket.sourceName,"POLYMARKET US");
  assert.deepEqual(snapshot.polymarket.sides.map(o=>o.name),["Ashlyn Krueger","Ann Li"]);
  assert.deepEqual(snapshot.polymarket.sides.map(o=>o.observed),[.40,.61]);
  assert.equal(snapshot.polymarket.kind,"OBSERVED · SOURCE QUOTE CLOCK UNVERIFIED");
});

test("ambiguous, one-sided, third-party and unmatched identities do not force or fabricate alignment",()=>{
  const names=["Maria Smith","Maya Smith"];
  const collision=[{name:"M. Smith",ask:.22},{name:"Maria Smith",ask:.78}];
  assert.strictEqual(alignTennisSnapshotSides(collision,names),collision);
  const exactButSharedSurname=[{name:"Maya Smith",ask:.67},{name:"Maria Smith",ask:.34}];
  const reordered=alignTennisSnapshotSides(exactButSharedSurname,names);
  assert.deepEqual(reordered.map(o=>o.name),["Maria Smith","Maya Smith"]);
  assert.deepEqual(reordered.map(o=>o.ask),[.34,.67]);
  const unmatched=[{name:"Different Player",ask:.15},{name:"Maria Smith",ask:.9}];
  assert.strictEqual(alignTennisSnapshotSides(unmatched,names),unmatched);
  const partial=[{name:"Ann Li",ask:.61}];
  assert.strictEqual(alignTennisSnapshotSides(partial,["Ann Li","Ashlyn Krueger"]),partial);
  const noRoster=[{name:"Ann Li",ask:.61},{name:"Ashlyn Krueger",ask:.41}];
  assert.strictEqual(alignTennisSnapshotSides(noRoster,[]),noRoster);
});

test("match card supplies away/home athlete order; source labels and market details remain unchanged",()=>{
  const source=readFileSync(new URL("../src/components/board/TennisMatchCard.jsx",import.meta.url),"utf8");
  assert.match(source,/tennisMarketSnapshot\(t,venueOffers,\[\s*away\.fullName\|\|away\.name,\s*home\.fullName\|\|home\.name/);
  assert.match(source,/marketSnapshot\.kalshi\.map/);
  assert.match(source,/marketSnapshot\.polymarket\.sides\.map/);
  assert.match(source,/o\.ask!=null\?"CLOB ask"/);
});

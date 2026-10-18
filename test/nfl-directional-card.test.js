import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=name=>readFile(new URL("../src/components/board/"+name,import.meta.url),"utf8");
test("NFL directional contract defines four paired units and rejects generic signal fallback",async()=>{
 const jsx=await read("NflDirectionalMatchups.jsx");
 for(const id of ["away-run-defense","away-run-offense","away-pass-defense","away-pass-offense"])assert.ok(jsx.includes(id));
 assert.match(jsx,/s\?\.available===true/);
 assert.match(jsx,/DIRECTIONAL DATA PENDING/);
 assert.match(jsx,/TeamLogo team=\{winner\}/);
 assert.match(jsx,/secondaryColor/);
});
test("NFL uses shared venue strip with sport-local four tile route",async()=>{
 const compact=await read("CompactGameCard.jsx");
 const premium=await read("PremiumGameCard.jsx");
 const css=await read("nflDirectionalMatchups.css");
 // SoftMatch: four-tile NFL route is on featured/premium; compact keeps venue + injury strip.
 assert.match(premium,/sportId === "nfl" \? <NflDirectionalMatchups/);
 assert.match(compact,/isNfl \? <NflInjuryIntegrityStrip/);
 assert.match(compact,/import VenueConditions from/);
 assert.match(compact,/!stored \? <VenueConditions/);
 assert.match(css,/--unit-secondary/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("NFL unit tiles use transparent logos and concise winning team identity",async()=>{
 const jsx=await read("NflDirectionalMatchups.jsx");
 const css=await read("nflDirectionalMatchups.css");
 assert.match(jsx,/nfl-unit-winner/);
 assert.match(jsx,/ADVANTAGE/);
 assert.doesNotMatch(jsx,/\} EDGE<\/strong>/);
 assert.match(css,/team-logo-plate/);
 assert.match(css,/background:transparent!important/);
 assert.match(css,/drop-shadow/);
});

test('current passing EPA fills unit comparisons without inventing Next Gen tracking inputs',async()=>{
 const {analyzeNflGameMatchup}=await import('../functions/lib/nflGameMatchup.js');
 const game={nflFeatures:{home:{passEpa:.12,passEpaAllowed:.01,rushEpa:.05,rushEpaAllowed:.02},away:{passEpa:.03,passEpaAllowed:.08,rushEpa:.02,rushEpaAllowed:.03}}};
 const x=analyzeNflGameMatchup(game,{ok:true,home:24,away:21,margin:3,total:45});
 assert.equal(x.unitMatchups.length,4);assert.ok(x.unitMatchups.every(v=>v.available));
 assert.ok(x.unitMatchups.every(v=>v.metric==='EPA per play'&&v.synopsis.includes('EPA/play')));
 assert.equal(x.signals.find(v=>v.id==='pressure').available,false);
});

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

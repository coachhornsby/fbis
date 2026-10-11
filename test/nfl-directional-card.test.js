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
test("NFL venue and weather are in hero with sport-local four tile route",async()=>{
 const jsx=await read("CompactGameCard.jsx");
 const css=await read("nflDirectionalMatchups.css");
 assert.match(jsx,/isNfl \? <NflDirectionalMatchups/);
 assert.match(jsx,/nfl-hero-venue/);
 assert.match(jsx,/!isNfl \? <VenueConditions/);
 assert.match(css,/--unit-secondary/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

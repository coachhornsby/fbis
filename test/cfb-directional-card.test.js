import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=name=>readFile(new URL("../src/components/board/"+name,import.meta.url),"utf8");
test("CFB directional panels specify four offense-versus-defense categories",async()=>{
 const src=await read("CfbDirectionalMatchups.jsx");
 for(const id of ["away-run-defense","away-run-offense","away-pass-defense","away-pass-offense"]) assert.ok(src.includes(id));
 assert.match(src,/cfbDirectionalEvidence/);
 assert.match(src,/passEpaAllowed/);
 assert.match(src,/rushEpaAllowed/);
 assert.match(src,/EFFICIENCY TILT/);
 assert.match(src,/CFBD ADJ. EPA GAP/);
 assert.match(src,/SOURCES DISAGREE/);
 assert.match(src,/TeamLogo team=\{winner\}/);
 assert.match(src,/altColor/);
 assert.match(src,/DIRECTIONAL DATA PENDING/);
});
test("CFB uses shared venue strip; tennis and other sports retain their routing",async()=>{
 const compact=await read("CompactGameCard.jsx");
 const premium=await read("PremiumGameCard.jsx");
 const css=await read("nflDirectionalMatchups.css");
 // SoftMatch: directional CFB tiles live on featured/premium; compact keeps shared venue strip.
 assert.match(premium,/sportId === "cfb" \? <CfbDirectionalMatchups/);
 assert.match(compact,/import VenueConditions from/);
 assert.match(compact,/!stored \? <VenueConditions/);
 assert.match(css,/data-sport="cfb"/);
 assert.match(css,/cfb-unit-panel/);
 assert.match(css,/--unit-secondary/);
});

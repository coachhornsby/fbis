import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {nflDirectionalEvidence} from "../src/components/board/NflDirectionalMatchups.jsx";
test("NFL directional contract reserves exactly four explicit unit battles",()=>{
 const rows=nflDirectionalEvidence({},null);
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(r=>r.id),["away-run-defense","away-run-offense","away-pass-defense","away-pass-offense"]);
 assert.ok(rows.every(r=>r.status==="UNAVAILABLE"&&r.winner===null));
});
test("NFL directional evidence never promotes generic run or coverage to directional advantages",()=>{
 const rows=nflDirectionalEvidence({},{signals:[{id:"run",available:true,adjustment:2},{id:"coverageRoute",available:true,adjustment:3}]});
 assert.ok(rows.every(r=>r.status==="UNAVAILABLE"));
 const verified=nflDirectionalEvidence({},{signals:[{id:"away-pass-defense",available:true,adjustment:-.5}]});
 assert.equal(verified[2].winner,"away");
 assert.ok(verified.filter(r=>r.status==="UNAVAILABLE").length===3);
});
test("NFL visuals place venue in hero and keep non-NFL route separate",async()=>{
 const jsx=await readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8");
 const css=await readFile(new URL("../src/components/board/nflDirectionalMatchups.css",import.meta.url),"utf8");
 assert.match(jsx,/isNfl \? <NflDirectionalMatchups/);
 assert.match(jsx,/nfl-hero-venue/);
 assert.match(jsx,/!isNfl \? <VenueConditions/);
 assert.match(css,/--unit-secondary/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

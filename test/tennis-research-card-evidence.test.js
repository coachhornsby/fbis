import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("independent Tennis cards do not imply bookmaker or head-to-head evidence",()=>{
 const src=readFileSync(new URL("../src/components/board/TennisMatchCard.jsx",import.meta.url),"utf8");
 assert.match(src,/hasObservedMarket\?\(t\.marketProvider/);
 assert.match(src,/No matched market observations/);
 assert.match(src,/H2H not established/);
 assert.match(src,/No verified matchup record/);
 assert.match(src,/researchOnly\?[`\x27"]ESPN /);
 assert.match(src,/Research fixture · Unverified event details/);
});

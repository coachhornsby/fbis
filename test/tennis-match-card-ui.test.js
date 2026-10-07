import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jsx=readFileSync(new URL("../src/components/board/TennisMatchCard.jsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/components/board/tennisMatchCard.css",import.meta.url),"utf8");

test("Tennis hero uses full identity, country treatment, centered VS, and neutral portrait fallback",()=>{
  assert.match(jsx,/tmc-player-side/);
  assert.match(jsx,/--tmc-flag/);
  assert.match(jsx,/countryColor/);
  assert.match(jsx,/tmc-vs">VS/);
  assert.match(jsx,/Player headshot unavailable/);
  assert.doesNotMatch(jsx,/slice\(0,4\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) 64px minmax\(0,1fr\)/);
});

test("Tennis recent form is vertically stacked and preserves explicit unavailable state",()=>{
  assert.match(jsx,/Recent form unavailable/);
  assert.match(jsx,/formRecord/);
  assert.match(css,/\.tmc-form\{display:flex;flex-direction:column\}/);
  assert.match(css,/\.tmc-form-results\{display:flex!important/);
});

test("Tennis UI refinement does not introduce wager authorization or synthetic missing rank values",()=>{
  assert.doesNotMatch(jsx,/canAuthorizeWager\s*=|bet\s*=|authorized\s*=/);
  assert.match(jsx,/RANK —/);
  assert.match(jsx,/POINTS —/);
  assert.doesNotMatch(jsx,/#0|EVEN/);
});

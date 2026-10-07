import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const jsx=readFileSync(new URL("../src/components/board/TennisMatchCard.jsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/components/board/tennisMatchCard.css",import.meta.url),"utf8");

test("Tennis card actually renders populated recent form and missing-form fallback",async()=>{
  const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:"custom"});
  try {
    const {default:TennisMatchCard}=await server.ssrLoadModule("/src/components/board/TennisMatchCard.jsx");
    const game={id:"render-regression",sport:"tennis",tour:"ATP",home:{name:"Home Player",countryCode:"USA"},away:{name:"Away Player",countryCode:"POL"},tennisProjection:{eventIntegrity:{valid:true},playerBank:{players:[{recentForm:[{result:"W"},{result:"L"},{result:"W"}]},{recentForm:[{result:"L"}]}]}}};
    const populated=renderToStaticMarkup(createElement(TennisMatchCard,{game}));
    assert.match(populated,/Home Player/);
    assert.match(populated,/Away Player/);
    assert.match(populated,/2–1/);
    assert.match(populated,/0–1/);
    assert.match(populated,/RECENT FORM \(LAST 5\)/);
    assert.match(populated,/Player headshot unavailable/);
    assert.match(populated,/Neutral player silhouette/);
    assert.match(populated,/flagcdn.com\/w80\/pl.png/);
    assert.match(populated,/flagcdn.com\/w80\/us.png/);
    assert.doesNotMatch(populated,/ATP #0|0 points|♙/);
    const withheld=renderToStaticMarkup(createElement(TennisMatchCard,{game:{...game,tennisProjection:{player1WinProb:.764,player2WinProb:.236}}}));
    assert.match(withheld,/withheld/);
    assert.doesNotMatch(withheld,/76.4|FAIR ML|WIN PROBABILITY/);
    const missing=renderToStaticMarkup(createElement(TennisMatchCard,{game:{...game,tennisProjection:{eventIntegrity:{valid:true}}}}));
    assert.equal((missing.match(/Recent form unavailable/g)||[]).length,2);
  } finally { await server.close(); }
});

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

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
    const projected=renderToStaticMarkup(createElement(TennisMatchCard,{game:{...game,tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.6,player2WinProb:.4,modelId:"TENNIS-FBIS-v2-CONTEXT",modelVersion:"verified-version"}}}));
    assert.match(projected,/TENNIS-FBIS-v2-CONTEXT · verified-version/);
    assert.doesNotMatch(projected,/model unavailable/i);
    const withheld=renderToStaticMarkup(createElement(TennisMatchCard,{game:{...game,tennisProjection:{player1WinProb:.764,player2WinProb:.236}}}));
    assert.match(withheld,/withheld/);
    assert.doesNotMatch(withheld,/76.4|FAIR ML|WIN PROBABILITY/);
    const independent=renderToStaticMarkup(createElement(TennisMatchCard,{game:{...game,
      id:"tennis:espn:atp:1:2",tennisProjection:{player1WinProb:null,player2WinProb:null,
        researchFixture:{verified:true,source:"ESPN_PUBLIC",fixtureId:"tennis:espn:atp:1:2"},
        venueOffers:[{source:"PinnOdds",marketFamily:"moneyline",period:"full_game",side:"home",decimalOdds:1.8},
          {source:"Polymarket US",marketFamily:"moneyline",period:"full_game",side:"away",contractPrice:.42}]}}}));
    assert.match(independent,/Independent ESPN research fixture/);
    assert.match(independent,/PROJECTION UNAVAILABLE/);
    assert.match(independent,/1.800 dec/);
    assert.match(independent,/42.0¢/);
    const {default:DecisionBoard}=await server.ssrLoadModule("/src/components/board/DecisionBoard.jsx");
    const officialGame={...game,id:"official-order",home:{name:"Official Home"},away:{name:"Official Away"}};
    const researchGame={...game,id:"tennis:espn:wta:order",home:{name:"Independent Home"},away:{name:"Independent Away"},tennisProjection:{researchFixture:{verified:true,source:"ESPN_PUBLIC",fixtureId:"tennis:espn:wta:order"}}};
    const separated=renderToStaticMarkup(createElement(DecisionBoard,{games:[researchGame,officialGame]}));
    assert.ok(separated.indexOf("Verified official Tennis schedule")<separated.indexOf("Official Away versus Official Home"));
    assert.ok(separated.indexOf("Official Away versus Official Home")<separated.indexOf("Independent Tennis research fixtures"));
    assert.ok(separated.indexOf("Independent Tennis research fixtures")<separated.indexOf("Independent Away versus Independent Home"));
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
\ntest("Tennis cards default to compact matchup with a native closed intelligence dropdown", async()=>{\n  const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:"custom"});\n  try {\n    const {default:TennisMatchCard}=await server.ssrLoadModule("/src/components/board/TennisMatchCard.jsx");\n    const game={id:"compact-regression",sport:"tennis",tour:"WTA",home:{name:"Iva Jovic",countryCode:"US",rank:11},away:{name:"Maja Chwalinska",countryCode:"PL",rank:22},tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.715,player2WinProb:.285,surface:"hard",tournament:"Wuhan Open"}};\n    const rendered=renderToStaticMarkup(createElement(TennisMatchCard,{game}));\n    assert.match(rendered,/class="tmc tmc-compact/);\n    assert.match(rendered,/28\\.5%/);\n    assert.match(rendered,/71\\.5%/);\n    assert.match(rendered,/MATCHUP INTELLIGENCE/);\n    assert.match(rendered,/FBIS PROJECTION/);\n    assert.match(rendered,/MODEL VS MARKET/);\n    assert.match(rendered,/RECENT FORM \\(LAST 5\\)/);\n    const match=rendered.match(/<details class="tmc-expand"[^>]*>/);\n    assert.ok(match,"matchup intelligence native details must exist");\n    assert.doesNotMatch(match[0],/\\bopen(?:=|\\s|>)/,"default closed");\n    assert.ok(rendered.indexOf("tmc-probability")<rendered.indexOf("tmc-expand"),"FBIS probability stays visible above dropdown");\n    assert.ok(rendered.indexOf("tmc-expand")<rendered.indexOf("tmc-main"),"full market/form panels are inside details");\n  } finally { await server.close(); }\n});\n\ntest("Tennis compact grid returns to two columns and details expand full width",()=>{\n  assert.match(css,/db-grid>\\.db-grid-item-tennis:has\\(>\\.tmc-compact\\)/);\n  assert.match(css,/tmc-expand\\[open\\]/);\n  assert.match(css,/@container\\(max-width:425px\\)/);\n  assert.match(css,/prefers-reduced-motion:reduce/);\n});\n
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load=name=>readFile(new URL("../src/components/board/"+name,import.meta.url),"utf8");
test("non-tennis compact cards preserve full names, enlarged logos and a bounded edge rail",async()=>{
 const [card,css]=await Promise.all([load("CompactGameCard.jsx"),load("universalPremiumCard.css")]);
 assert.match(card,/fbis-universal-premium/);
 assert.match(card,/fbis-full-team-name/);
 assert.match(card,/size=\{118\}/);
 assert.doesNotMatch(card,/className="cgc-abbr"/);
 assert.match(card,/NflDirectionalMatchups/);
 assert.match(css,/cgc-best-edge>\*/);
 assert.match(css,/overflow-wrap:anywhere/);
 assert.match(css,/tone-neutral/);
 assert.match(css,/prefers-reduced-motion/);
});
test("premium card remains sport specialized and tennis route stays separate",async()=>{
 const [premium,css]=await Promise.all([load("PremiumGameCard.jsx"),load("universalPremiumCard.css")]);
 assert.match(premium,/return <TennisMatchCard/);
 assert.match(premium,/fbis-universal-premium/);
 assert.match(premium,/size=\{120\}/);
 assert.match(css,/\.fbis-universal-premium/);
 assert.doesNotMatch(css,/\[data-sport="tennis"\]/);
});

test("featured cards give both full team names a balanced width and keep tennis isolated",async()=>{
 const css=await load("universalPremiumCard.css");
 assert.match(css,/\.pgc-featured-team-home\{/);
 assert.match(css,/flex-direction:column!important/);
 assert.match(css,/word-break:normal!important/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) minmax\(140px,\.65fr\) minmax\(0,1fr\)/);
 assert.match(css,/\.nhl-evidence-block>strong/);
 assert.doesNotMatch(css,/\[data-sport="tennis"\]/);
});
test('shared cards keep their layout on MARKET and BOARD without route-only selectors',async()=>{
 const [css,premium,signals]=await Promise.all([load('universalPremiumCard.css'),load('premiumGameCard.css'),load('matchupSignals.css')]);
 assert.doesNotMatch(css,/\.fbis-shell-main\.route-board/);
 assert.doesNotMatch(premium,/\.fbis-shell-main\.route-board/);
 assert.match(signals,/max-width:560px/);
 assert.match(signals,/repeat\(2,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(signals,/tmc|tennis/);
});

test("horizontal spread gap retains team logo and totals show directional OVER/UNDER identity", async () => {
  const [card, css] = await Promise.all([load("CompactGameCard.jsx"), load("compactGameCardEnhancements.css")]);
  assert.match(card, /referenceLead\?\.kind === "total"/);
  assert.match(card, /<TotalGapDirection side=\{referenceLead\.side\} \/>/);
  assert.match(card, /referenceTeam \? <><TeamLogo team=\{referenceTeam\}/);
  assert.match(card, /<TotalGapDirection side=\{edge\.detail\} \/>/);
  assert.match(card, /direction === "over" \? "↑" : "↓"/);
  assert.match(card, /CAPTURED LINE · NOT EV/);
  assert.match(css, /cgc-total-direction-arrow/);
  assert.match(css, /cgc-total-direction-label/);
  assert.match(css, /cgc-total-direction\.is-over/);
  assert.match(css, /cgc-total-direction\.is-under/);
});

test("spread gap colors follow the compared team and preserve totals, unavailable and research labels",async()=>{
 const [card,css]=await Promise.all([load("CompactGameCard.jsx"),load("compactGameCardEnhancements.css")]);
 assert.match(card,/const referenceTeam = showReferenceGap && referenceLead\?\.kind === "spread"/);
 assert.match(card,/const gapTeam = soccerPick \? soccerPickTeam : showReferenceGap \? referenceTeam : !edge\.total \? edge\.team : null/);
 assert.match(card,/gapBrandColor\(gapTeam, rawGapTeam, sportId\)/);
 assert.match(card,/cgc-gap-team-branded/);
 assert.match(card,/--cgc-gap-brand/);
 assert.match(card,/cgc-gap-side-name/);
 assert.match(card,/size=\{100\} tone="light" className="cgc-edge-logo"/);
 assert.match(card,/CAPTURED LINE · NOT EV/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-team-branded/);
 assert.match(css,/--cgc-gap-accent/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-total-under/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-total-over/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-neutral/);
});

test("non-tennis featured cards share the horizontal gap treatment across all scoreboard sports",async()=>{
 const [card,css]=await Promise.all([load("PremiumGameCard.jsx"),load("universalPremiumCard.css")]);
 assert.match(card,/const gapColor = gapBrandColor\(gapTeam, gapRawTeam, sportId\)/);
 assert.match(card,/const comparison = bestEdge\(vm\)/);
 assert.match(card,/className=\{`pgc-gap-strip/);
 assert.match(card,/className="pgc-gap-logo"/);
 assert.match(card,/gapSide==="over"\?"↑":"↓"/);
 assert.match(card,/showReferenceGap \? "FBIS \/ PINNODDS GAP"/);
 assert.match(card,/const gapUnit = \["mlb","npb","kbo"\]/);
 assert.match(card,/sportId === "nhl" \? "GOALS" : "PTS"/);
 assert.match(css,/\.pgc-gap-strip\.is-branded/);
 assert.match(css,/\.pgc-gap-strip\.is-total\.is-over/);
 assert.match(css,/\.pgc-gap-strip\.is-total\.is-under/);
 assert.doesNotMatch(css,/\.fbis-shell-main\.route-board/);
});

test("gap-bar team logos are enlarged without white plates on compact and featured cards",async()=>{
 const [compact,featured,compactCss,featuredCss]=await Promise.all([
  load("CompactGameCard.jsx"),load("PremiumGameCard.jsx"),
  load("compactGameCardEnhancements.css"),load("universalPremiumCard.css")
 ]);
 assert.match(compact,/size=\{100\} tone="light" className="cgc-edge-logo"/);
 assert.match(featured,/size=\{100\} tone="light" className="pgc-gap-logo"/);
 assert.match(compactCss,/\.cgc-edge-logo\.team-logo-fallback \{\s*width: 100px !important;\s*height: 100px !important;/);
 assert.match(compactCss,/\.cgc-edge-logo \.team-logo \{\s*width: 94px !important;\s*height: 94px !important;/);
 assert.match(compactCss,/\.cgc-edge-logo\.team-logo-fallback \{\s*width: 72px !important;\s*height: 72px !important;/);
 assert.match(compactCss,/\.cgc-edge-logo \.team-logo \{\s*width: 68px !important;\s*height: 68px !important;/);
 assert.match(featuredCss,/\.pgc-gap-logo\.team-logo-fallback \{\s*width:100px!important;\s*height:100px!important;/);
 assert.match(featuredCss,/\.pgc-gap-logo \.team-logo \{\s*width:94px!important;\s*height:94px!important;/);
 assert.match(featuredCss,/width:72px!important;height:72px!important;min-width:72px;/);
 assert.match(featuredCss,/\.pgc-gap-logo \.team-logo \{width:68px!important;height:68px!important\}/);
 assert.match(compactCss,/#39ff14/);
 assert.match(compactCss,/#ff1a1a/);
 assert.match(featuredCss,/#39ff14/);
 assert.match(featuredCss,/#ff1a1a/);
 assert.match(compactCss,/#1a1020/);
 assert.match(featuredCss,/#1a1020/);
 assert.match(compactCss,/cgc-gap-total-under > small/);
 assert.match(featuredCss,/pgc-gap-description/);
});

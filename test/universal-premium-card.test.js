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

test("value bar preserves branding only for qualified price-supported selections",async()=>{
 const [compact,premium]=await Promise.all([load("CompactGameCard.jsx"),load("PremiumGameCard.jsx")]);
 assert.match(compact,/bestValuePresentation\(game,\s*vm\)/);
 assert.match(premium,/bestValuePresentation\(game,\s*vm\)/);
 assert.match(compact,/valueChoice\.teamSide/);
 assert.match(premium,/valueChoice\.teamSide/);
 assert.match(compact,/size=\{100\} tone="light" className="cgc-edge-logo"/);
 assert.match(premium,/size=\{100\} tone="light" className="pgc-gap-logo"/);
 assert.match(compact,/<TotalGapDirection side=\{valueChoice\.totalDirection\} \/>/);
 assert.match(premium,/valueChoice\.totalDirection==="over"\?"↑":"↓"/);
 assert.match(compact,/cgc-gap-neutral/);
 assert.match(premium,/is-neutral/);
});
test("unqualified cards do not advertise model-line difference as expected betting value",async()=>{
 const [compact,premium]=await Promise.all([load("CompactGameCard.jsx"),load("PremiumGameCard.jsx")]);
 assert.match(compact,/valueChoice\.value/);
 assert.match(premium,/valueChoice\.value/);
 assert.doesNotMatch(compact,/>FBIS \/ PINNODDS GAP</);
 assert.doesNotMatch(premium,/>FBIS \/ PINNODDS GAP</);
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
 assert.match(compactCss,/@keyframes cgc-gap-neon-over/);
 assert.match(compactCss,/@keyframes cgc-gap-sheen/);
 assert.match(compactCss,/@keyframes cgc-gap-arrow-under/);
 assert.match(featuredCss,/@keyframes pgc-gap-neon-under/);
 assert.match(featuredCss,/@keyframes pgc-gap-sheen/);
 assert.match(compactCss,/prefers-reduced-motion: reduce/);
});

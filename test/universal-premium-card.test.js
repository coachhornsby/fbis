import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load=name=>readFile(new URL("../src/components/board/"+name,import.meta.url),"utf8");
test("non-tennis compact cards preserve full names, 25 percent bigger logos and a bounded edge rail",async()=>{
 const [card,css]=await Promise.all([load("CompactGameCard.jsx"),load("universalPremiumCard.css")]);
 assert.match(card,/fbis-universal-premium/);
 assert.match(card,/fbis-full-team-name/);
 assert.match(card,/size=\{83\}/);
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
 assert.match(premium,/size=\{103\}/);
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

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
 assert.match(card,/const gapTeam = showReferenceGap \? referenceTeam : !edge\.total \? edge\.team : null/);
 assert.match(card,/normalizeTeamColor\(gapTeam, null\)/);
 assert.match(card,/cgc-gap-team-branded/);
 assert.match(card,/--cgc-gap-brand/);
 assert.match(card,/cgc-gap-side-name/);
 assert.match(card,/size=\{64\} className="cgc-edge-logo"/);
 assert.match(card,/CAPTURED LINE · NOT EV/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-team-branded/);
 assert.match(css,/--cgc-gap-accent/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-total-under/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-total-over/);
 assert.match(css,/\.cgc-best-edge\.cgc-gap-neutral/);
});

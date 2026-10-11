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
 assert.match(card,/--fbis-tile-team/);
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

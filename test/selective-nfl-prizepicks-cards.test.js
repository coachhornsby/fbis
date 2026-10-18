import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("NFL selective board keeps projected PrizePicks cards below 4 stars", () => {
  const src = fs.readFileSync("functions/api/selective-props.js", "utf8");
  assert.match(src, /NFL_PRIZEPICKS_CARDS_ALL_PROJECTED/);
  assert.match(src, /PRIZEPICKS_CARD/);
  assert.doesNotMatch(src, /NFL_4STAR_PLUS_WITH_49ERS_EXCEPTION/);
  // Hide-gate removed: 4★ is a badge/mode, not a filter that empties the board.
  assert.doesNotMatch(src, /allowed\.add\(key\)/);
  assert.match(src, /resolvedPlayerHeadshot|isPlayerHeadshotUrl/);
});

test("PrizePicks market panel always shows headshot, PP/FBIS metrics, and last-5 bars", () => {
  const panel = fs.readFileSync("src/features/playerProps/PrizePicksMarketPanel.jsx", "utf8");
  assert.match(panel, /function PrizePicksPropCard/);
  assert.match(panel, /function LastFiveBars/);
  assert.match(panel, /pp-card-last5/);
  assert.match(panel, /pp-premium-headshot/);
  assert.match(panel, /PP LINE/);
  assert.match(panel, /FBIS/);
  assert.match(panel, /usePlayerPropDetail\(r, true\)/);
  assert.doesNotMatch(panel, /<ZenPrizePicksLines/);
});

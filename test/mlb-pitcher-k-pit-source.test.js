import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { HISTORICAL_PITCHER_K_MARKETS } from "../functions/api/mlb-pitcher-k-pit-source.js";

test("historical pitcher-K source is read-only and tightly market-scoped",()=>{
  assert.deepEqual([...HISTORICAL_PITCHER_K_MARKETS],[
    "SPORTSBOOK_PROP:player_strikeouts",
    "SPORTSBOOK_PROP:player_pitcher_strikeouts",
    "SPORTSBOOK_PROP:player_strikeouts_thrown",
  ]);
  const src=fs.readFileSync(new URL("../functions/api/mlb-pitcher-k-pit-source.js",import.meta.url),"utf8");
  assert.match(src,/authorizeHarvest/);
  assert.match(src,/historical_pitcher_k_source/);
  assert.match(src,/readOnly:true/);
  assert.match(src,/canQualify:false/);
  assert.match(src,/canAuthorizeWager:false/);
  assert.match(src,/autoPromotion:false/);
  assert.doesNotMatch(src,/\bINSERT\b/i);
  assert.doesNotMatch(src,/\bUPDATE\b/i);
  assert.doesNotMatch(src,/\bDELETE\b/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("MLB pitcher-K PIT scale-up freezes calibration and economic policy",()=>{
  const src=fs.readFileSync(new URL("../scripts/mlb-pitcher-k-pit-scaleup.mjs",import.meta.url),"utf8");
  assert.match(src,/HISTORICAL_PIT_RECONSTRUCTED/);
  assert.match(src,/MLB_PITCH_ZONE_K_CALIBRATION/);
  assert.match(src,/refit:false/);
  assert.match(src,/historicalEvidenceAloneCannotPromote:true/);
  assert.match(src,/canQualify:false/);
  assert.match(src,/canAuthorizeWager:false/);
  assert.match(src,/alternateLinesIncreaseN:false/);
  assert.match(src,/booksIncreaseN:false/);
  assert.match(src,/END_DATE.*2026-10-05/);
});

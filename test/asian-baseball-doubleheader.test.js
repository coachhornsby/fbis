import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGameId,dedupeGames } from "../functions/lib/asianBaseballHistory.js";

test("canonical KBO identity preserves ordinary IDs and distinguishes doubleheaders",()=>{
  const base={league:"KBO",gameDate:"2025-05-17",awayTeamId:"kbo-kt",homeTeamId:"kbo-lg"};
  assert.equal(canonicalGameId({...base,gameNo:0}),"KBO-20250517-kbo-kt-kbo-lg");
  assert.equal(canonicalGameId({...base,gameNo:1}),"KBO-20250517-kbo-kt-kbo-lg-g1");
  assert.equal(canonicalGameId({...base,gameNo:2}),"KBO-20250517-kbo-kt-kbo-lg-g2");
  assert.equal(dedupeGames([{...base,gameNo:1},{...base,gameNo:2}]).length,2);
});
test("ordinary September canonical identity stays backward compatible",()=>{
  assert.equal(canonicalGameId({league:"KBO",gameDate:"2025-09-20",awayTeamId:"kbo-sam",homeTeamId:"kbo-lg",gameNo:0}),
    "KBO-20250920-kbo-sam-kbo-lg");
});

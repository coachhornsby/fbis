import test from "node:test";
import assert from "node:assert/strict";
import {reconcile} from "../scripts/cfb-projection-reconcile.mjs";
const source={name:"week05.csv",content:"id,start_date,season,week,home_team,away_team\n12,2026-09-30 00:00:00,2026,5,Home,Away\n13,2026-09-30 00:00:00,2026,5,Home2,Away2"};
test("counts missing receipts, accepts only existing pregame captures",()=>{
 const a=reconcile([source],[{game_id:"12",season:2026,created_at:"2026-09-29T01:00:00Z",model_version:"AA",projected_margin:3}]);
 assert.equal(a.total,2);assert.equal(a.verifiedSaved,1);assert.equal(a.missing,1);
 assert.equal(a.rows[0].graded,false);assert.equal(a.promotionAuthorized,false);
});
test("rejects late captures and timestamps without UTC offset",()=>{
 const a=reconcile([source],[{game_id:"12",created_at:"2026-10-01T00:00:00Z",model_version:"AA",projected_margin:3},
 {game_id:"13",created_at:"2026-09-29 00:00:00",model_version:"AA",projected_margin:3}]);
 assert.equal(a.verifiedSaved,0);assert.equal(a.matchedButInvalid,2);
});
test("rejects duplicated game identity across sources",()=>{
 assert.throws(()=>reconcile([source,source],[]),/DUPLICATE_ACROSS_WEEKS/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeProPlayerPropMarket } from "../functions/lib/proPlayerProps.js";
import { selectiveCandidateRows } from "../functions/api/selective-props.js";

test("NFL derivative labels do not canonicalize to base passing yards", () => {
  assert.equal(canonicalizeProPlayerPropMarket("nfl","Halves with 100+ Pass Yards"), null);
  assert.equal(canonicalizeProPlayerPropMarket("nfl","Pass Yards"), "passing_yards");
});

test("NFL selective cards use Standard full-game PrizePicks lines only", () => {
  const base={sport:"nfl",player_name:"QB One",canonical_market:"passing_yards",stat_type:"Pass Yards",
    fbis_projection:250,fbis_sigma:50,line:230,role_confidence:.9,snap_share:1,
    prop_gate:"CLEAR",eligible_for_card:1,feature_evidence_json:JSON.stringify({targetRole:true,recent5:true,nextGen:true,snapShare:true,opponentMatchup:true,positionDefense:true})};
  const rows=[
    {...base,id:1,odds_tier:"standard",duration:"Full",collected_at:"2026-10-04T12:00:00Z"},
    {...base,id:2,line:180,odds_tier:"goblin",duration:"Full",collected_at:"2026-10-04T12:00:00Z"},
    {...base,id:3,line:320,odds_tier:"demon",duration:"Full",collected_at:"2026-10-04T12:00:00Z"},
    {...base,id:4,line:120,odds_tier:"standard",duration:"1H",collected_at:"2026-10-04T12:00:00Z"},
  ];
  const out=selectiveCandidateRows(rows,"nfl");
  assert.equal(out.length,1);
  assert.equal(out[0].odds_tier,"standard");
  assert.equal(out[0].duration,"Full");
  assert.equal(out[0].line,230);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NHL_GOALIE_PROB_SHADOW_ID,
  NHL_GOALIE_PROB_SHADOW_VERSION,
  projectNhlGoalieProbabilityShadow,
} from "../functions/lib/nhlGoalieProbabilityShadow.js";

function game(){
  return {
    id:"g1",sport:"nhl",start:"2026-10-10T00:00:00Z",
    home:{abbr:"BOS"},away:{abbr:"WPG"},odds:{homeML:-110,awayML:-105},
    nhlProV2:{
      ok:true,home:"BOS",away:"WPG",projHome:3.2,projAway:2.9,
      probability:{homeWinIncludingOt:0.57,eloHead:0.56},
      layers:{goalie:{
        home:{impactPerShot:0.006,reliability:0.8},
        away:{impactPerShot:-0.004,reliability:0.8},
      }}
    }
  };
}
const profiles={
  teams:{bos:{team_key:"bos"},wpg:{team_key:"wpg"}},
  players:{bos:[],wpg:[]},goalies:{bos:[],wpg:[]},linemates:{bos:[],wpg:[]},schedule:{bos:[],wpg:[]}
};

test("goalie probability shadow preserves NHL-PRO-v2 score projection",()=>{
  const x=projectNhlGoalieProbabilityShadow(game(),profiles);
  assert.equal(x.ok,true);
  assert.equal(x.modelId,NHL_GOALIE_PROB_SHADOW_ID);
  assert.equal(x.modelVersion,NHL_GOALIE_PROB_SHADOW_VERSION);
  assert.equal(x.incumbent.projHome,x.challenger.projHome);
  assert.equal(x.incumbent.projAway,x.challenger.projAway);
  assert.equal(x.challenger.scoreProjectionChanged,false);
  assert.equal(x.challenger.goalieProbabilityScale,0.25);
  assert.ok(x.challenger.homeWinProbability>0&&x.challenger.homeWinProbability<1);
  assert.equal(x.canQualify,false);
  assert.equal(x.canAuthorizeWager,false);
  assert.equal(x.stakingAuthorized,false);
});

test("goalie shadow fails closed to context-only without persisted state",()=>{
  const x=projectNhlGoalieProbabilityShadow(game(),{});
  assert.equal(x.ok,true);
  assert.equal(x.gateFired,false);
  assert.equal(x.mode,"CONTEXT_ONLY");
});

test("goalie shadow API is research-only and freezes required state fields",async()=>{
  const src=await readFile(new URL("../functions/api/nhl-goalie-shadow.js",import.meta.url),"utf8");
  for(const token of ["ev_deployment_json","pp_deployment_json","scratches_availability_json","replacement_mapping_json","market_snapshot_json","code_sha"]){
    assert.match(src,new RegExp(token));
  }
  assert.match(src,/productionChampion:"NHL-PRO-v2"/);
  assert.match(src,/productionChanged:false/);
  assert.match(src,/authority:false/);
  assert.match(src,/staking:false/);
});

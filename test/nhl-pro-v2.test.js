import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NHL_PRO_V2_ID,
  NHL_PRO_V2_VERSION,
  projectNhlProV2Game,
  attachNhlProV2,
  loadNhlProV2Context,
} from "../functions/lib/nhlProV2.js";
import { promoteNhlResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import { getModel } from "../functions/lib/canonical/modelRegistry.js";
import { NHL_PRO_V2_ARTIFACT } from "../data/models/nhl-pro-v2.js";

function ctx(promoted=false){
  return {
    ok:true,
    edge:{
      BOS:{available:true,offensiveZonePct:0.35,defensiveZonePct:0.31,leagueAvg:0.333},
      WPG:{available:true,offensiveZonePct:0.32,defensiveZonePct:0.35,leagueAvg:0.333},
    },
    artifact:{
      trained:true,
      artifactVersion:"test-v2",
      league:{goals:3.05,xg:2.35,specialTeamsXg:0.7,shots:30},
      teams:{
        BOS:{gfpg:3.2,gapg:2.8,xgf:2.50,xga:2.20,stxgf:0.75,shotsFor:31},
        WPG:{gfpg:3.0,gapg:3.1,xgf:2.25,xga:2.55,stxgf:0.66,shotsFor:29},
      },
      shooters:{
        "1":{factor:1.10},"2":{factor:1.04},"3":{factor:0.96},"4":{factor:1.00},
      },
      goalies:{
        "10":{impactPerShot:0.006},"20":{impactPerShot:-0.004},
      },
      xgModel:{trees:[{feature:0,threshold:0.5,left:0.1,right:-0.05}]},
      promotion:{historicalPromotionEligible:promoted,promotedToResearchBoard:promoted},
    },
    base:{
      ok:true,
      teams:{
        BOS:{games:10,gfpg:3.3,gapg:2.7},
        WPG:{games:10,gfpg:2.9,gapg:3.2},
      },
      skatersByTeam:{
        BOS:[
          {id:"1",shotsPerGame:4,pointsPerGame:1.1},
          {id:"2",shotsPerGame:3,pointsPerGame:0.8},
        ],
        WPG:[
          {id:"3",shotsPerGame:3.5,pointsPerGame:0.7},
          {id:"4",shotsPerGame:2.7,pointsPerGame:0.6},
        ],
      },
      currentGoalies:[
        {id:"10",name:"BOS G",teams:["BOS"],starts:8},
        {id:"20",name:"WPG G",teams:["WPG"],starts:9},
      ],
      priorGoalies:[],
    },
    sourceLineage:{livePrimary:{id:"NHL_OFFICIAL_API"}},
    marketInformed:false,canQualify:false,canAuthorize:false,
  };
}
const game={sport:"nhl",start:"2026-10-10T00:00:00Z",home:{abbr:"BOS"},away:{abbr:"WPG"},odds:{total:6.5,spread:-1.5}};

test("NHL-PRO-v2 emits independent score and probability layers",()=>{
  const p=projectNhlProV2Game(game,ctx(false));
  assert.equal(p.ok,true);
  assert.equal(p.modelId,NHL_PRO_V2_ID);
  assert.equal(p.modelVersion,NHL_PRO_V2_VERSION);
  assert.ok(Number.isFinite(p.projHome));
  assert.ok(Number.isFinite(p.projAway));
  assert.ok(p.probability.homeWinIncludingOt>0&&p.probability.homeWinIncludingOt<1);
  assert.equal(p.layers.distribution.family,"BIVARIATE_POISSON");
  assert.equal(p.layers.tracking.source,"NHL_EDGE_EXPANDED_OPTIONAL");
  assert.equal(p.layers.tracking.expanded.activation,"RESEARCH_ADVISORY_ONLY");
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,true);
  assert.equal(p.canAuthorizeWager,false);
});

test("market price changes do not change NHL-PRO-v2 fair score or ML probability",()=>{
  const a=projectNhlProV2Game({...game,odds:{...game.odds,homeML:-105,awayML:-105}},ctx(false));
  const b=projectNhlProV2Game({...game,odds:{...game.odds,homeML:-250,awayML:210}},ctx(false));
  assert.equal(a.projHome,b.projHome);
  assert.equal(a.projAway,b.projAway);
  assert.equal(a.probability.homeWinIncludingOt,b.probability.homeWinIncludingOt);
});

test("v2 attaches as challenger but cannot displace v1 without historical gate",()=>{
  const baseGame={...game,nhlV1:{ok:true,modelId:"NHL-FBIS-v1",modelVersion:"v1",projHome:3.0,projAway:2.8,note:"v1"}};
  const attached=attachNhlProV2([baseGame],ctx(false)).games;
  assert.equal(attached[0].challengers[NHL_PRO_V2_ID].ok,true);
  const board=promoteNhlResearchToBoard(attached);
  assert.equal(board.meta.modelId,"NHL-FBIS-v1");
  assert.equal(board.meta.v2Promoted,0);
});

test("v2 may become the research-board model only after strict historical promotion",()=>{
  const baseGame={...game,nhlV1:{ok:true,modelId:"NHL-FBIS-v1",modelVersion:"v1",projHome:3.0,projAway:2.8,note:"v1"}};
  const attached=attachNhlProV2([baseGame],ctx(true)).games;
  const board=promoteNhlResearchToBoard(attached);
  assert.equal(board.meta.modelId,NHL_PRO_V2_ID);
  assert.equal(board.meta.v2Promoted,1);
  assert.equal(board.games[0].projectionEngine,NHL_PRO_V2_ID);
  assert.equal(board.games[0].researchProjection.modelId,NHL_PRO_V2_ID);
  assert.equal(board.games[0].canQualify,false);
});

test("NHL-PRO-v2 is registered as independent research with no wager authority",()=>{
  const m=getModel(NHL_PRO_V2_ID);
  assert.ok(m);
  assert.equal(m.sport,"nhl");
  assert.equal(m.marketInformed,false);
  assert.equal(m.independent,true);
  assert.equal(m.canQualify,false);
  assert.equal(m.canAuthorizeWager,false);
});

test("v2 walk-forward declares PIT/no-market integrity and explicit incumbent comparison",async()=>{
  const src=await readFile(new URL("../scripts/nhl-pro-v2-walkforward.mjs",import.meta.url),"utf8");
  assert.match(src,/pointInTime:true/);
  assert.match(src,/noMarketInputs:true/);
  assert.match(src,/priorSeasonOnlyTraining:true/);
  assert.match(src,/currentSeasonOnlyPastGames:true/);
  assert.match(src,/beatsIncumbent/);
  assert.doesNotMatch(src,/pinnacle|heritage|sportsbook|closingLine/i);
});

test("trained NHL-PRO-v2 artifact carries the validated research-promotion gate",()=>{
  assert.equal(NHL_PRO_V2_ARTIFACT.trained,true);
  assert.equal(NHL_PRO_V2_ARTIFACT.training.games,3936);
  assert.ok(NHL_PRO_V2_ARTIFACT.training.shots>300000);
  assert.equal(NHL_PRO_V2_ARTIFACT.training.fetchErrors,0);
  assert.equal(NHL_PRO_V2_ARTIFACT.promotion.historicalPromotionEligible,true);
  assert.equal(NHL_PRO_V2_ARTIFACT.promotion.canAuthorizeWager,false);
  assert.ok(NHL_PRO_V2_ARTIFACT.validation.challenger.marginMae < NHL_PRO_V2_ARTIFACT.validation.incumbent.marginMae);
  assert.ok(NHL_PRO_V2_ARTIFACT.validation.challenger.totalMae < NHL_PRO_V2_ARTIFACT.validation.incumbent.totalMae);
  assert.ok(NHL_PRO_V2_ARTIFACT.validation.challenger.brier < NHL_PRO_V2_ARTIFACT.validation.incumbent.brier);
});

test("live NHL context fails open to trained priors instead of hanging the board",async()=>{
  const rejectingFetcher=async()=>{ throw new Error("UPSTREAM_UNAVAILABLE"); };
  const games=[{id:"timeout-fallback-test",sport:"nhl",home:{abbr:"BOS"},away:{abbr:"WPG"},start:"2026-10-11T00:00:00Z"}];
  const first=await loadNhlProV2Context("2026-10-10",games,{fetcher:rejectingFetcher});
  assert.equal(first.ok,true);
  assert.equal(first.degraded,true);
  assert.equal(first.base.degraded,true);
  assert.equal(first.base.fallbackReason,"LIVE_NHL_CONTEXT_UNAVAILABLE");
  assert.ok(Object.keys(first.base.teams).length>=20);
  assert.equal(first.canAuthorize,false);
  const second=await loadNhlProV2Context("2026-10-10",games,{fetcher:rejectingFetcher});
  assert.equal(second.ok,true);
  assert.equal(second.cacheHit,true);
});

test("NHL-PRO-v2 exposes a whole-number most-likely score and situational winner head",()=>{
  const x=ctx(false);
  x.base.schedule=[
    {id:"prior-bos",start:"2026-10-08T00:00:00Z",home:"NYR",away:"BOS"},
    {id:"prior-wpg",start:"2026-10-08T00:00:00Z",home:"WPG",away:"MIN"},
  ];
  const p=projectNhlProV2Game(game,x);
  assert.equal(p.ok,true);
  assert.ok(Number.isInteger(p.projectedScore.home));
  assert.ok(Number.isInteger(p.projectedScore.away));
  assert.ok(p.projectedScore.probability>0);
  assert.equal(p.winnerHead.ok,true);
  assert.ok(["BOS","WPG"].includes(p.projectedWinner));
  assert.equal(p.winnerHead.probabilitySource,"NHL-PRO-v2");
  assert.equal(p.winnerHead.calibratedHomeWinProbability,p.probability.homeWinIncludingOt);
  assert.ok(Number.isFinite(p.winnerHead.situational.homeTravelMiles));
  assert.ok(Number.isFinite(p.winnerHead.situational.awayTravelMiles));
  assert.equal(p.winnerHead.canAuthorizeWager,false);
});

test("winner direction remains independent of sportsbook moneyline prices",()=>{
  const x=ctx(false);
  x.base.schedule=[
    {id:"prior-bos",start:"2026-10-08T00:00:00Z",home:"NYR",away:"BOS"},
    {id:"prior-wpg",start:"2026-10-08T00:00:00Z",home:"WPG",away:"MIN"},
  ];
  const a=projectNhlProV2Game({...game,odds:{...game.odds,homeML:-105,awayML:-105}},x);
  const b=projectNhlProV2Game({...game,odds:{...game.odds,homeML:-300,awayML:240}},x);
  assert.equal(a.projectedWinner,b.projectedWinner);
  assert.equal(a.winnerHead.classifierScore,b.winnerHead.classifierScore);
});

test("verified pregame confirmed starter supersedes high-start-count proxy; stale/future confirmation does not",()=>{
  const context=ctx(false);
  context.artifact.goalies["11"]={impactPerShot:.02};
  context.base.currentGoalies.push({id:"11",name:"BOS confirmed backup",teams:["BOS"],starts:2});
  context.sourceLineage.asOf="2026-10-09T22:00:00Z";
  context.persistentProfiles={goalies:{bos:[{
    player_id:"11",player_name:"BOS confirmed backup",goalie_state:"CONFIRMED_STARTER",
    source_updated_at:"2026-10-09T20:00:00Z",starts:2
  }]}};
  const verified=projectNhlProV2Game(game,context);
  assert.equal(verified.layers.goalie.home.goalieId,"11");
  assert.equal(verified.layers.goalie.home.selectionState,"PIT_CONFIRMED_STARTER");
  assert.equal(verified.eventId,null);
  assert.equal(verified.featureCutoffTimestamp,"2026-10-09T22:00:00Z");
  const bad=structuredClone(context);
  bad.persistentProfiles.goalies.bos[0].source_updated_at="2026-10-10T01:00:00Z";
  const fallback=projectNhlProV2Game(game,bad);
  assert.equal(fallback.layers.goalie.home.goalieId,"10");
  assert.equal(fallback.layers.goalie.home.selectionState,"HISTORICAL_STARTS_PROXY");
  assert.notEqual(verified.projAway,fallback.projAway);
});

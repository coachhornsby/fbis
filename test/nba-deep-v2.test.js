import test from "node:test";
import assert from "node:assert/strict";
import { haversineMiles, buildNbaScheduleContext, NBA_TEAM_GEO } from "../functions/lib/nbaTravelContext.js";
import { classifyNbaShot, buildGameShotProfiles, shotProfileEdge } from "../functions/lib/nbaShotProfile.js";
import { teamHistoryRow, buildNbaDeepFeatures, NBA_DEEP_FEATURE_NAMES } from "../functions/lib/nbaDeepFeatures.js";
import { projectNbaDeepGame } from "../functions/lib/nbaDeepModel.js";

function hist(teamId,abbr,oppId,oppAbbr,n=12){
  const rows=[];
  for(let i=0;i<n;i++){
    rows.push({
      date:`2026-01-${String(i+1).padStart(2,"0")}T01:00:00Z`,
      gameId:String(i),teamId,abbr,pointsFor:115+i%5,pointsAgainst:110+i%4,possessions:99+i%3,
      offRtg:116+i%3,defRtg:112+i%2,efg:.56+i*.0005,tovPct:.125,orbPct:.26,ftRate:.24,
      oppEfg:.54,oppTovPct:.135,oppOrbPct:.24,oppFtRate:.23,
      shot:{rimRate:.34,paintRate:.12,midRate:.17,threeRate:.37,rimPct:.68,paintPct:.48,midPct:.43,threePct:.37,twoPct:.55},
      oppShot:{rimRate:.32,paintRate:.13,midRate:.19,threeRate:.36,rimPct:.66,paintPct:.47,midPct:.42,threePct:.35,twoPct:.54}
    });
  }
  return rows;
}

test("travel context computes real distance and time-zone crossings",()=>{
  const d=haversineMiles(NBA_TEAM_GEO.BOS,NBA_TEAM_GEO.LAL);
  assert.ok(d>2500&&d<2700);
  const games=[
    {start:"2026-01-01T03:00:00Z",homeId:"1",awayId:"2",home:{abbr:"LAL"},away:{abbr:"BOS"}},
    {start:"2026-01-03T03:00:00Z",homeId:"3",awayId:"1",home:{abbr:"DEN"},away:{abbr:"LAL"}}
  ];
  const target={start:"2026-01-04T03:00:00Z",homeId:"4",awayId:"1",home:{abbr:"BOS"},away:{abbr:"LAL"}};
  const c=buildNbaScheduleContext([...games,target],target,2,"away");
  assert.equal(c.backToBack,true);
  assert.ok(c.travelMiles>800);
});

test("shot classifier distinguishes rim, midrange and three",()=>{
  assert.equal(classifyNbaShot({text:"Player makes driving layup",scoringPlay:true}).zone,"rim");
  assert.equal(classifyNbaShot({text:"Player misses 25-foot three point jumper",scoringPlay:false}).zone,"three");
  assert.equal(classifyNbaShot({text:"Player makes pullup jump shot",scoringPlay:true}).zone,"midrange");
});

test("shot profiles aggregate attempts and efficiency",()=>{
  const x=buildGameShotProfiles({plays:[
    {teamId:"H",text:"A makes driving layup",scoringPlay:true},
    {teamId:"H",text:"A misses three point jumper",scoringPlay:false},
    {teamId:"H",text:"A makes pullup jump shot",scoringPlay:true},
  ]});
  assert.equal(x.H.attempts,3);
  assert.equal(x.H.rimA,1);
  assert.equal(x.H.threeA,1);
  const e=shotProfileEdge(x.H,{threePct:.34,rimPct:.65,threeRate:.35,rimRate:.32});
  assert.ok(Number.isFinite(e.expectedEfg));
});

test("deep feature vector includes four factors, travel, lineup and interactions",()=>{
  const homeHistory=hist("H","DEN","A","LAL"),awayHistory=hist("A","LAL","H","DEN");
  const game={id:"g",start:"2026-02-01T01:00:00Z",homeId:"H",awayId:"A",home:{abbr:"DEN"},away:{abbr:"LAL"},neutralSite:false};
  const f=buildNbaDeepFeatures(game,{
    homeHistory,awayHistory,
    homeSchedule:{daysRest:2,travelMiles:0,altitudeFeet:5280},
    awaySchedule:{daysRest:0,backToBack:true,travelMiles:900,timeZonesCrossed:1,altitudeFeet:5280},
    homeLineup:{offense:1.2,defense:.5,net:1.7,continuity:.8},
    awayLineup:{offense:.4,defense:-.2,net:.2,continuity:.55}
  });
  assert.equal(f.ok,true);
  assert.equal(f.vector.length,NBA_DEEP_FEATURE_NAMES.length);
  assert.ok(f.values.efgMatchupDiff!==undefined);
  assert.ok(f.values.altitudeFatigueInteraction>0);
  assert.ok(f.values.lineupNetDiff>0);
});

test("deep model remains market-free and shadow-only",()=>{
  const homeHistory=hist("H","DEN","A","LAL"),awayHistory=hist("A","LAL","H","DEN");
  const fit={
    version:"test",
    margin:{means:Array(NBA_DEEP_FEATURE_NAMES.length).fill(0),scales:Array(NBA_DEEP_FEATURE_NAMES.length).fill(1),intercept:0,coefficients:Array(NBA_DEEP_FEATURE_NAMES.length).fill(0),stumps:[],sigma:13},
    total:{means:Array(NBA_DEEP_FEATURE_NAMES.length).fill(0),scales:Array(NBA_DEEP_FEATURE_NAMES.length).fill(1),intercept:0,coefficients:Array(NBA_DEEP_FEATURE_NAMES.length).fill(0),stumps:[],sigma:17}
  };
  const p=projectNbaDeepGame({id:"g",start:"2026-02-01T01:00:00Z",homeId:"H",awayId:"A",home:{abbr:"DEN"},away:{abbr:"LAL"}},{
    homeHistory,awayHistory,homeSchedule:{daysRest:2},awaySchedule:{daysRest:1}
  },fit);
  assert.equal(p.ok,true);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.equal(p.incumbent.margin,p.margin);
});

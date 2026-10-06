import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePersistentPlayerState,deriveScheduleStress,scheduleWeakSpots,replacementCandidates,
  injuryType,injurySeverity
} from "../functions/lib/nbaTeamProfile.js";

test("persistent OUT state carries until stronger evidence arrives",()=>{
  const s=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    priorState:{status:"OUT",state_source_timestamp:"2026-10-05T12:00:00Z",injury_detail:"Right ankle sprain",as_of:"2026-10-05T12:00:00Z"},
    availabilityRows:[],lineupRows:[],gameAppearances:[],asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(s.status,"OUT");
  assert.equal(s.carriedForward,true);
  assert.equal(s.injuryType,"ANKLE");
});

test("newer confirmed lineup overrides carried OUT state",()=>{
  const s=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    priorState:{status:"OUT",state_source_timestamp:"2026-10-05T12:00:00Z",injury_detail:"Right ankle sprain"},
    lineupRows:[{player_id:"23",player_name:"LeBron James",lineup_status:"STARTER",observed_at:"2026-10-06T23:00:00Z"}],
    asOf:"2026-10-06T23:30:00Z"
  });
  assert.equal(s.status,"AVAILABLE");
  assert.equal(s.source,"CONFIRMED_LINEUP");
  assert.equal(s.carriedForward,false);
});

test("actual game appearance overrides older injury evidence",()=>{
  const s=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    availabilityRows:[{player_id:"23",player_name:"LeBron James",status:"OUT",source:"NBA_OFFICIAL_INJURY_REPORT",observed_at:"2026-10-05T12:00:00Z",injury_detail:"Right ankle sprain"}],
    gameAppearances:[{date:"2026-10-06T02:00:00Z",minutes:31}],
    asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(s.status,"AVAILABLE");
  assert.equal(s.source,"ACTUAL_GAME_APPEARANCE");
});

test("injury classifier records type and coarse severity without auto-return",()=>{
  assert.equal(injuryType("Right ankle sprain"),"ANKLE");
  assert.equal(injurySeverity("Grade 2 right ankle sprain","OUT"),"MODERATE");
  assert.equal(injurySeverity("Right ankle sprain","OUT"),"UNKNOWN_OUT");
});

test("schedule stress flags back-to-backs, travel and altitude",()=>{
  const schedule=[
    {gameId:"1",startTime:"2026-10-10T02:00:00Z",homeAway:"home",homeTeamKey:"LAL",venueTeamKey:"LAL",opponentKey:"PHX"},
    {gameId:"2",startTime:"2026-10-11T01:00:00Z",homeAway:"away",homeTeamKey:"DEN",venueTeamKey:"DEN",opponentKey:"DEN"},
    {gameId:"3",startTime:"2026-10-13T01:00:00Z",homeAway:"away",homeTeamKey:"BOS",venueTeamKey:"BOS",opponentKey:"BOS"}
  ];
  const rows=deriveScheduleStress(schedule,"LAL");
  assert.equal(rows[1].backToBack,true);
  assert.ok(rows[1].travelMiles>700);
  assert.ok(rows[1].stressReasons.includes("ALTITUDE_ROAD_GAME"));
  assert.ok(rows[2].timeZonesCrossed>=2);
  assert.ok(scheduleWeakSpots(schedule,"LAL",{asOf:"2026-10-09T00:00:00Z"}).length>=2);
});

test("replacement map prefers active same-position rotation players",()=>{
  const roster=[
    {id:"a",name:"A",position:"SF",expectedMinutes:34},
    {id:"b",name:"B",position:"SF",expectedMinutes:25},
    {id:"c",name:"C",position:"PG",expectedMinutes:32},
    {id:"d",name:"D",position:"SF",expectedMinutes:12},
  ];
  const states={a:{status:"OUT"},b:{status:"AVAILABLE"},c:{status:"AVAILABLE"},d:{status:"AVAILABLE"}};
  const r=replacementCandidates("a",roster,states,{});
  assert.equal(r[0].playerId,"b");
  assert.ok(r[0].score>r.find(x=>x.playerId==="c").score);
});


test("stale game appearance does not certify current availability",()=>{
  const s=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    gameAppearances:[{date:"2026-04-10T02:00:00Z",minutes:34}],
    asOf:"2026-10-05T12:00:00Z"
  });
  assert.equal(s.status,"UNKNOWN");
  assert.equal(s.source,"ROSTER_UNVERIFIED");
});


test("fresh carried questionable and probable states transition only on newer evidence",()=>{
  const base={player:{id:"23",name:"LeBron James"},asOf:"2026-10-06T12:00:00Z"};
  const q=resolvePersistentPlayerState({...base,priorState:{status:"QUESTIONABLE",state_source_timestamp:"2026-10-05T12:00:00Z"}});
  assert.equal(q.status,"QUESTIONABLE");
  const p=resolvePersistentPlayerState({...base,priorState:{status:"QUESTIONABLE",state_source_timestamp:"2026-10-05T12:00:00Z"},availabilityRows:[{player_id:"23",player_name:"LeBron James",status:"PROBABLE",source:"NBA_OFFICIAL_INJURY_REPORT",observed_at:"2026-10-06T10:00:00Z"}]});
  assert.equal(p.status,"PROBABLE");
  const active=resolvePersistentPlayerState({...base,priorState:{status:"PROBABLE",state_source_timestamp:"2026-10-06T10:00:00Z"},lineupRows:[{player_id:"23",player_name:"LeBron James",lineup_status:"ACTIVE",observed_at:"2026-10-06T11:00:00Z"}]});
  assert.equal(active.status,"AVAILABLE");
});

test("newer official OUT and QUESTIONABLE states supersede older carried states",()=>{
  const out=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},priorState:{status:"QUESTIONABLE",state_source_timestamp:"2026-10-05T12:00:00Z"},
    availabilityRows:[{player_id:"23",player_name:"LeBron James",status:"OUT",source:"NBA_OFFICIAL_INJURY_REPORT",observed_at:"2026-10-06T10:00:00Z"}],
    asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(out.status,"OUT");
  const q=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},priorState:{status:"OUT",state_source_timestamp:"2026-10-05T12:00:00Z",injury_detail:"Right ankle sprain"},
    availabilityRows:[{player_id:"23",player_name:"LeBron James",status:"QUESTIONABLE",source:"NBA_OFFICIAL_INJURY_REPORT",observed_at:"2026-10-06T10:00:00Z"}],
    asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(q.status,"QUESTIONABLE");
});

test("expired carried evidence degrades to UNKNOWN instead of certifying availability forever",()=>{
  const available=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    priorState:{status:"AVAILABLE",state_source_timestamp:"2026-06-01T12:00:00Z"},
    asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(available.status,"UNKNOWN");
  assert.equal(available.source,"ROSTER_UNVERIFIED");
  const oldOut=resolvePersistentPlayerState({
    player:{id:"23",name:"LeBron James"},
    priorState:{status:"OUT",state_source_timestamp:"2026-01-01T12:00:00Z",injury_detail:"Right ankle sprain"},
    asOf:"2026-10-06T12:00:00Z"
  });
  assert.equal(oldOut.status,"UNKNOWN");
  assert.equal(oldOut.source,"ROSTER_UNVERIFIED");
});
